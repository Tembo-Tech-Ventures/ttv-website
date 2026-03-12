# CLAUDE.md

This file provides context for Claude Code when working on the TTV Website project.

## Project Overview

TTV Website is a Next.js 14 (App Router) full-stack application for Tembo Tech Ventures, a tech training platform. The main application code lives in `web/`. See `ARCHITECTURE.md` for a full architectural overview.

## Quick Reference

```bash
cd web
docker compose up -d          # Start local services (Postgres, Mailhog, S3Mock)
npm install                   # Install deps + prisma generate
npm run dev                   # Run migrations + start dev server (port 3000)
npm test                      # Run Jest tests
npm run lint                  # ESLint
npm run lint-fix              # ESLint with auto-fix
```

**Important**: All `npm` commands must be run from the `web/` directory.

## Project Structure

```
web/src/
├── app/                      # Next.js App Router
│   ├── (public)/             # Public pages (homepage) - has footer + GSAP
│   ├── (admin)/              # Admin dashboard - sidebar, requires ADMIN role
│   ├── (dashboard)/          # User dashboard - sidebar, requires auth
│   ├── (certificate)/        # Certificate display - minimal layout
│   ├── auth/                 # Login, register, verify-request, logout
│   ├── blog/                 # Public blog index, [slug], rss.xml
│   ├── api/                  # API routes (auth, v1 Hono, file, admin)
├── modules/                  # Feature modules (see below)
├── components/               # Shared UI (Card, Link)
├── providers/                # RootProvider (SessionProvider + MuiProvider)
├── types/                    # MUI theme type extensions
└── assets/                   # Brand assets (elephant logo)
```

Other key files:
- `web/prisma/schema.prisma` — Database schema (PostgreSQL)
- `web/compose.yaml` — Docker services for local dev
- `web/docs/blogging.md` — Blogging feature documentation

## Module Organization

Business logic is organized in `src/modules/<feature>/` with:
- `lib/<function-name>/index.ts` — Server-side logic with barrel export
- `components/<component-name>/` — React components
- `hooks/<hook-name>/` — Client-side React hooks
- `constants.ts` — Shared constants

### Module Reference

| Module | Key Exports | Purpose |
|--------|-------------|---------|
| `auth` | `getServerSession`, `getAccess`, `EmailLoginForm`, `useLoginRedirect` | Session management, login UI |
| `roles` | `isAdmin`, `checkAdminPermissions`, `enableAdmin`, `ROLES` | RBAC (ADMIN, EDUCATOR) |
| `blog` | `createPost`, `getPosts`, `getPost`, `updatePost`, `deletePost`, `uploadImage`, `generateRss` | Blog CRUD + images + RSS |
| `prisma` | `prisma` | Prisma client singleton |
| `s3` | `s3Client` | S3-compatible storage client |
| `mui` | `theme`, `MuiProvider`, color constants, `getShadow` | MUI theme + provider |
| `analytics` | `PageTracker`, `Identifier`, `useAnalytics` | RudderStack tracking |
| `gsap` | `ScrollTriggerInit` | GSAP plugin registration |
| `api` | `client` | Type-safe Hono API client |

## Route Groups

The app uses Next.js route groups (parenthesized folders) for layout separation:
- `(public)` — Public pages with footer and GSAP ScrollTrigger
- `(admin)` — Admin dashboard with sidebar drawer (requires ADMIN role, uses `useLoginRedirect`)
- `(dashboard)` — User dashboard with sidebar drawer (requires auth, uses `useLoginRedirect`)
- `(certificate)` — Minimal layout for certificate display (no nav, no footer)

## Key Patterns

### Path Alias
Use `@/` to reference `src/`. Example: `import { getServerSession } from "@/modules/auth/lib/get-server-session"`

### Authentication
- `getServerSession()` — Get typed session on the server (includes `user.id`, `user.emailVerified`)
- `getAccess()` — Get session or redirect to login (currently a stub)
- `checkAdminPermissions()` — Throws if user lacks ADMIN role (used in API routes and admin pages)
- `isAdmin()` — Boolean admin check (used for conditional UI rendering)
- `useLoginRedirect()` — Client hook that redirects unauthenticated users to `/auth/login`

Auth flow: email-only passwordless via NextAuth 4. Magic links valid for 10 minutes. Sessions stored in PostgreSQL via PrismaAdapter. No middleware.ts — auth guards are at the layout/page level.

### API Routes
REST API uses Hono at `/api/v1/[[...route]]`:
- Validate with `zValidator("json", zodSchema)` — use `.passthrough()` for dynamic form data
- Auth via `getServerSession()` — return 401 if no session
- Admin checks via `checkAdminPermissions()` — throws on unauthorized
- Call `revalidatePath()` after mutations to refresh Next.js cache
- The `AppType` export enables type-safe frontend calls via `hono/client`

### Database
Prisma ORM with PostgreSQL. Schema at `web/prisma/schema.prisma`.
- Create migration: `cd web && npx prisma migrate dev --name describe-change`
- Prisma client singleton: `@/modules/prisma/lib/prisma-client`
- Migrations auto-run on `npm run dev` and during build
- Application form data stored as JSON blob in `ProgramApplication.application`

### Styling
- MUI 5 dark theme with custom colors: orange primary (#F28D68), dark teal (#013D39), lighter teal (#2C6964)
- Fonts: Climate Crisis (headings h1-h6), Maven Pro (body)
- Use MUI `sx` prop for styling; styled-components for custom elements
- `getShadow("sm" | "md" | "lg")` utility for consistent shadows
- GSAP ScrollTrigger for homepage animations only

### Server vs Client Components
Pages and layouts are server components by default. Add `"use client"` directive only when the component needs browser APIs, event handlers, or React hooks. Layout components that render interactive sidebars are client components.

## Environment

Dev environment variables are in `web/.env`. Key ones:
- `POSTGRES_PRISMA_URL` — Database connection
- `EMAIL_SERVER` / `EMAIL_FROM` — SMTP for auth emails (Mailhog in dev)
- `NEXTAUTH_URL` — App URL (auto-configured for Codespaces)
- `S3_ENDPOINT` / `ACCESS_KEY_ID` / `SECRET_ACCESS_KEY` — File storage (S3Mock in dev)

Production also needs: `NEXTAUTH_SECRET`, `S3_REGION`, `S3_BUCKET`, `S3_PUBLIC_BASE_URL`, `SITE_URL`.

Docker Compose must be running for local dev:
- PostgreSQL on port 5432
- Mailhog on ports 8025 (UI) and 1025 (SMTP) — view magic link emails here
- S3Mock on port 9090

## Testing

Jest with Testing Library. Tests live alongside source files (`*.test.ts` / `*.test.tsx`). Run `npm test` from `web/`. Mocks for NextAuth and PrismaAdapter are in `src/__mocks__/`.

## CI/CD

GitHub Actions workflow (`.github/workflows/ci.yml`) runs on push to main and PRs:
1. `npm ci` → `npm run lint` → `npm test`

## Common Tasks

### Add a new page
Create `src/app/(route-group)/path/page.tsx`. Auth is handled by parent layouts. For admin pages, also call `await checkAdminPermissions()` at the top.

### Add an API endpoint
1. Create handler file under `src/app/api/v1/[[...route]]/`
2. Define Hono router with Zod validation
3. Register in the main `route.ts` with `.route("/path", handler)`

### Add a database model
Edit `prisma/schema.prisma`, run `cd web && npx prisma migrate dev --name describe-change`.

### Add a new module
Create `src/modules/<feature>/` with `lib/`, `components/`, `hooks/` subdirectories as needed.

### Get admin access in dev
Log in, then visit `/admin/enable-admin`.

### Blog management
Use the admin interface at `/admin/blog/new`. Images are resized to 1200px width before S3 upload. See `web/docs/blogging.md`.

## Database Models (Quick Reference)

| Model | Purpose |
|-------|---------|
| `User`, `Account`, `Session`, `VerificationToken` | NextAuth auth |
| `Role`, `UserRole` | RBAC (ADMIN, EDUCATOR) |
| `Curriculum`, `Program` | Training programs |
| `ProgramRole` | Instructor/TA assignments (enum: INSTRUCTOR, TA) |
| `ProgramPartner` | Partner organizations |
| `ProgramApplication` | Student applications (status: PENDING/APPROVED/REJECTED/AUDIT/COMPLETED) |
| `BlogPost` | Blog posts (title, slug, markdown content, author) |
| `File` | Uploaded file metadata |

## API Endpoints (Quick Reference)

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/v1/program-application` | POST | User | Create application |
| `/api/v1/program-application/:id` | PUT | User | Update own application |
| `/api/v1/program-application/:id/admin` | PUT | Admin | Admin update application status |
| `/api/v1/program-partner` | GET | None | List partners |
| `/api/v1/program-role` | POST | Admin | Assign instructor/TA |
| `/api/v1/program-role/:id` | DELETE | Admin | Remove role assignment |
| `/api/v1/user` | PUT | User | Update own profile |
| `/api/v1/user/:id/admin` | PUT | Admin | Admin update user |
| `/api/file` | POST | User | Get signed S3 upload URL |
| `/api/admin/blog/upload` | POST | Admin | Upload blog image |
