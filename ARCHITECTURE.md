# TTV Website Architecture

This document describes the architecture, technology choices, and conventions used in the TTV Website project. It is intended for developers onboarding to the codebase or returning after time away.

## Overview

TTV Website is a full-stack web application for **Tembo Tech Ventures**, a tech training platform. It supports:

- **Public marketing pages** with animated hero sections
- **Blogging system** with Markdown editor, image uploads, and RSS
- **User authentication** via passwordless email login
- **Student application workflow** with dynamic forms and status tracking
- **Curriculum delivery** via Sanity headless CMS
- **Admin dashboards** for managing users, applications, programs, and blog posts
- **Certificate generation** for completed programs
- **File uploads** to S3-compatible storage

The entire application lives inside the `web/` directory as a single Next.js project.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 14 (App Router) |
| Language | TypeScript 5.2 |
| UI Components | Material-UI (MUI) 5 |
| CSS-in-JS | Emotion (via MUI), styled-components |
| Animations | GSAP + ScrollTrigger |
| Database | PostgreSQL 16 |
| ORM | Prisma 5 |
| API Layer | Hono (mounted inside Next.js API routes) |
| Authentication | NextAuth 4 (email provider, passwordless) |
| CMS | Sanity (headless, embedded studio) |
| File Storage | S3-compatible (Tigris in prod, S3Mock in dev) |
| State Management | Jotai (atoms for form state) |
| Data Fetching | SWR |
| Validation | Zod |
| Analytics | RudderStack |
| Email | Nodemailer (Mailhog in dev) |
| Testing | Jest + Testing Library |
| Deployment | Vercel |

## Directory Structure

```
ttv-website/
├── web/                          # The Next.js application
│   ├── src/
│   │   ├── app/                  # App Router (pages, layouts, API routes)
│   │   │   ├── (admin)/          # Admin dashboard (route group)
│   │   │   ├── (dashboard)/      # User dashboard (route group)
│   │   │   ├── (public)/         # Public pages (route group)
│   │   │   ├── (certificate)/    # Certificate display
│   │   │   ├── auth/             # Login, register, verify, logout
│   │   │   ├── blog/             # Public blog index + posts + RSS
│   │   │   ├── api/              # API endpoints
│   │   │   │   ├── auth/         # NextAuth handler
│   │   │   │   ├── v1/           # Hono REST API (catch-all)
│   │   │   │   ├── admin/        # Admin-only endpoints (blog image upload)
│   │   │   │   └── file/         # File upload/delete
│   │   │   └── content-studio/   # Embedded Sanity CMS
│   │   ├── components/           # Shared UI components (Card, Link)
│   │   ├── modules/              # Feature modules (see below)
│   │   ├── providers/            # React context providers (RootProvider)
│   │   ├── types/                # Shared TypeScript types (MUI theme extensions)
│   │   ├── assets/               # Static assets (elephant logo)
│   │   └── __mocks__/            # Jest mocks (NextAuth, PrismaAdapter)
│   ├── prisma/
│   │   ├── schema.prisma         # Database schema
│   │   ├── seed.ts               # Seed script
│   │   └── migrations/           # Migration history (16 migrations)
│   ├── sanity/                   # Sanity CMS schemas and config
│   │   ├── env.ts                # Sanity project config
│   │   ├── lib/                  # Sanity client and image helpers
│   │   ├── schema.ts             # Schema registry
│   │   └── schema/documents/     # Course, Chapter, Lesson schemas
│   ├── public/                   # Static files served by Next.js
│   ├── docs/                     # Feature documentation
│   └── compose.yaml              # Docker services for dev
├── .github/workflows/            # CI/CD (lint + test on push/PR to main)
├── .devcontainer/                # GitHub Codespaces / devcontainer config
└── .vscode/                      # Editor settings
```

## Modules (`src/modules/`)

The project organizes business logic into feature modules under `src/modules/`. Each module contains a combination of `lib/` (server-side logic, data access), `components/` (React components), and `hooks/` (client-side hooks).

| Module | Purpose | Key Exports |
|--------|---------|-------------|
| `analytics/` | RudderStack page tracking and user identification | `PageTracker`, `Identifier`, `useAnalytics` |
| `api/` | Hono type-safe API client for frontend calls | `client` (typed Hono client) |
| `auth/` | Session helpers, email login form, redirect hook | `getServerSession`, `getAccess`, `EmailLoginForm`, `useLoginRedirect` |
| `blog/` | CRUD for blog posts, image upload, RSS generation | `createPost`, `getPosts`, `getPost`, `updatePost`, `deletePost`, `uploadImage`, `generateRss` |
| `gsap/` | GSAP ScrollTrigger plugin initialization | `ScrollTriggerInit` |
| `mui/` | MUI theme definition, fonts, and ThemeProvider | `theme`, `MuiProvider`, color constants |
| `prisma/` | Prisma client singleton (avoids connection pool issues in dev) | `prisma` |
| `roles/` | Admin/educator role checks and assignment | `isAdmin`, `checkAdminPermissions`, `enableAdmin`, `ROLES` |
| `s3/` | S3 client configuration (Tigris in prod, S3Mock in dev) | `s3Client` |

## Routing

The project uses Next.js App Router with **route groups** (parenthesized folders) to apply different layouts without affecting URL paths.

### Layout Hierarchy

```
Root Layout (SessionProvider + MUI ThemeProvider + Analytics)
├── (public)  → Dark gradient background, Footer, GSAP ScrollTrigger
│   └── (home)/page.tsx  →  /  (animated hero, values, features)
├── (admin)   → Admin sidebar drawer, login redirect, admin auth check
│   └── admin/*  (user mgmt, application review, programs, blog)
├── (dashboard) → User sidebar drawer, login redirect, auth check
│   └── dashboard/*  (apply, applications, profile, curriculum)
├── (certificate) → Minimal layout (no nav, no footer)
│   └── certificate/[application-id]
├── auth/*    → Dark gradient, no footer (login, register, verify, logout)
├── blog/*    → Public blog (index, [slug], rss.xml)
├── content-studio/* → Embedded Sanity CMS studio
└── api/*     → API endpoints (no layout)
```

### Key Routes

| Path | Purpose | Auth |
|------|---------|------|
| `/` | Public homepage with animated sections | None |
| `/blog` | Blog index listing all posts | None |
| `/blog/[slug]` | Individual blog post rendered from Markdown | None |
| `/blog/rss.xml` | RSS feed | None |
| `/auth/login` | Email login (redirects to dashboard if authenticated) | None |
| `/auth/register` | Registration (same form as login) | None |
| `/auth/verify-request` | "Check your email" confirmation page | None |
| `/auth/logout` | Calls `signOut()` and redirects to `/` | Session |
| `/dashboard` | User dashboard home (redirects to apply if no applications) | Session |
| `/dashboard/apply` | Program application form | Session |
| `/dashboard/application/[id]` | View/edit own application | Session |
| `/dashboard/profile` | User profile editing | Session |
| `/dashboard/curriculum` | Curriculum content from Sanity CMS | Session |
| `/dashboard/content` | Content library | Session |
| `/admin` | Admin dashboard home | ADMIN |
| `/admin/user` | User management table | ADMIN |
| `/admin/user/[user-id]` | Individual user detail (roles, applications) | ADMIN |
| `/admin/application` | Application review table | ADMIN |
| `/admin/application/[id]` | Review application detail, change status | ADMIN |
| `/admin/program` | Program management table | ADMIN |
| `/admin/program/[id]` | Program detail, assign instructors/TAs | ADMIN |
| `/admin/blog` | Blog post management table | ADMIN |
| `/admin/blog/new` | Create blog post with Markdown editor | ADMIN |
| `/admin/blog/[slug]/edit` | Edit existing blog post | ADMIN |
| `/admin/enable-admin` | Dev utility: grant ADMIN role to self | Session |
| `/certificate/[id]` | Certificate display (requires COMPLETED status) | None |
| `/content-studio` | Embedded Sanity CMS studio | None |

## API Design

REST API endpoints are built with **Hono** mounted as a Next.js catch-all route at `/api/v1/[[...route]]`. Hono provides middleware, routing, and Zod-based request validation via `@hono/zod-validator`.

The Hono app type is exported as `AppType` from the route file, enabling type-safe API calls from the frontend via `hono/client`.

### API Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/v1/program-application` | POST | User | Create application (stores form data as JSON blob) |
| `/api/v1/program-application/:id` | PUT | User | Update own application |
| `/api/v1/program-application/:id/admin` | PUT | Admin | Admin update application (status changes) |
| `/api/v1/program-partner` | GET | None | List partner organizations |
| `/api/v1/program-role` | POST | Admin | Assign instructor/TA to program |
| `/api/v1/program-role/:id` | DELETE | Admin | Remove role assignment |
| `/api/v1/user` | PUT | User | Update own profile (name, image) |
| `/api/v1/user/:id/admin` | PUT | Admin | Admin update user name |
| `/api/file` | POST | User | Get signed S3 upload URL |
| `/api/file/[file-id]/delete` | POST | User | Delete uploaded file |
| `/api/admin/blog/upload` | POST | Admin | Upload and resize blog image to S3 |

### API Patterns

- **Validation**: All Hono endpoints use `zValidator("json", zodSchema)` for request body validation. Application endpoints use `.passthrough()` to allow dynamic form fields.
- **Auth**: `getServerSession()` retrieves the current user. Returns 401 if no session.
- **Admin guards**: `checkAdminPermissions()` throws if user lacks ADMIN role (caught as 500).
- **Cache revalidation**: Endpoints call `revalidatePath()` after mutations to refresh Next.js cache.

## Database

PostgreSQL with Prisma ORM. The schema lives at `web/prisma/schema.prisma`.

### Core Models

**Authentication (NextAuth)**
- `User` — email, name, image, emailVerified
- `Account` — OAuth provider linking (cascade deletes with User)
- `Session` — database-backed sessions (cascade deletes with User)
- `VerificationToken` — email magic link tokens

**Authorization**
- `Role` — role definitions (ADMIN, EDUCATOR; name is unique)
- `UserRole` — many-to-many user-role assignments (cascade deletes)

**Programs & Curriculum**
- `Curriculum` — training curriculum (title, description)
- `Program` — training program with dates, linked to a Curriculum
- `ProgramRole` — instructor/TA assignments (enum: INSTRUCTOR, TA)
- `ProgramPartner` — partner organizations

**Applications**
- `ProgramApplication` — student applications
  - `status`: PENDING → APPROVED/REJECTED/AUDIT → COMPLETED
  - `application`: JSON blob storing dynamic form responses
  - `completedAt`: set when status becomes COMPLETED

**Content**
- `BlogPost` — title, slug (unique), markdown content, authorId
- `File` — uploaded file metadata (name, type, size, path, ownerId)

### Migrations

There are 16 migrations in `prisma/migrations/`. Migrations auto-run on `npm run dev` and during build (`npm run build` calls `migrate:deploy`). The build migration script has a fallback that skips if the database is unreachable.

## Authentication

NextAuth 4 with **email-only passwordless** login:

1. User enters email at `/auth/login`
2. NextAuth sends a magic link via SMTP (10-minute expiry)
3. User clicks the link to authenticate
4. Session is created in the database via PrismaAdapter
5. Session callback enriches the session with the full user object (including `id` and `emailVerified`)

**Auth utilities:**
- `getServerSession()` — server-side session retrieval with typed `CustomSession` (includes `user.id`, `user.emailVerified`)
- `getAccess()` — currently a stub returning `{ role: "user", content: null }` (used by layouts)
- `checkAdminPermissions()` — queries UserRole table, throws if user lacks ADMIN role
- `isAdmin()` — boolean version of admin check (returns true/false)
- `enableAdmin()` — idempotent function to grant ADMIN role to current user (dev utility)
- `useLoginRedirect()` — client hook that redirects unauthenticated users to `/auth/login`

**No middleware.ts** — auth guards are implemented at the layout and page level, not via Next.js middleware.

## Features

### Homepage

The public homepage at `/` is a client component with four animated sections:
- **Header** — elephant logo with GSAP ScrollTrigger animations on title text
- **Value** — animated gradient border with fade-in text
- **Features** — "What We Do" cards (Training, Mentorship, Impact) in responsive grid
- **Our Values** — core values with animated heart icon (Empowerment, Impact, Equity, Community, Innovation)

### Blogging

Admin users create/edit posts at `/admin/blog` using a Markdown editor (`@uiw/react-md-editor`). Posts are stored in PostgreSQL with the `BlogPost` model. Images are uploaded to S3 and resized to 1200px width via Sharp. The public blog at `/blog` renders markdown with `react-markdown` using custom styled components for headings, paragraphs, code blocks, and blockquotes. RSS feed at `/blog/rss.xml`. See `web/docs/blogging.md` for details.

### Program Applications

Students apply to programs through a dynamic form at `/dashboard/apply`. The form supports text, textarea, boolean, number, and date fields. Applications are stored as JSON blobs in `ProgramApplication.application`. Admins review at `/admin/application` and transition status through the workflow: PENDING → APPROVED/REJECTED/AUDIT → COMPLETED.

### Certificates

When an application status is set to COMPLETED (with a `completedAt` date), a certificate is viewable at `/certificate/[application-id]`. The certificate displays:
- Student name
- Curriculum title
- Certificate ID (application ID)
- Issue date (formatted as "MMMM DD, YYYY")
- Instructor name (from ProgramRole where role = INSTRUCTOR)

### Curriculum & Content

Curriculum content is managed through **Sanity CMS** (headless). The Sanity studio is embedded at `/content-studio`. Schemas define three document types:
- **Course** — top-level with title, slug, and portable text content
- **Chapter** — belongs to a Course
- **Lesson** — belongs to a Chapter

Content is fetched via GROQ queries using `next-sanity`.

### File Uploads

Files are uploaded via signed S3 URLs. The client requests a signed URL from `/api/file`, then uploads directly to S3. File metadata (name, type, size, path) is stored in Prisma. Max file size: 2MB.

### Analytics

RudderStack integration for tracking:
- **Page views** — `PageTracker` component in root layout tracks route changes
- **User identification** — `Identifier` component identifies authenticated users
- **Client-side** — `useAnalytics()` hook lazily loads the RudderStack JS SDK
- **Server-side** — `server-analytics.ts` initializes the Node SDK

## Styling

- **MUI Theme**: Custom dark mode theme with orange primary (#F28D68), dark teal background (#013D39), and lighter teal secondary (#2C6964)
- **Typography**: Climate Crisis font for headings (h1-h6), Maven Pro for body text
- **Component Styling**: MUI `sx` prop for most styling, styled-components for custom elements
- **Shadows**: Custom `getShadow(size)` utility for sm/md/lg shadow variants
- **Theme Overrides**: MuiToolbar and MuiDrawer backgrounds set to dark teal
- **Animations**: GSAP ScrollTrigger on public homepage sections

## Development Setup

### Prerequisites

- Node.js 20+
- Docker (for local PostgreSQL, Mailhog, S3Mock)

### Getting Started

```bash
cd web
docker compose up -d          # Start PostgreSQL, Mailhog, S3Mock
npm install                   # Install dependencies (runs prisma generate)
npm run dev                   # Run migrations + start dev server (port 3000)
```

### Local Services (via Docker Compose)

| Service | Port | Purpose |
|---------|------|---------|
| PostgreSQL 16 | 5432 | Database |
| Mailhog | 8025 (UI), 1025 (SMTP) | Email testing (view magic links here) |
| S3Mock (Adobe) | 9090 | S3-compatible file storage with `ttv-application-files` bucket |

### Environment Variables

Development defaults are configured in `web/.env`. Key variables:

| Variable | Purpose |
|----------|---------|
| `POSTGRES_PRISMA_URL` | PostgreSQL connection string |
| `EMAIL_SERVER` | SMTP connection string (Mailhog in dev) |
| `EMAIL_FROM` | Sender email address |
| `NEXTAUTH_URL` | Application URL (auto-configured for Codespaces) |
| `NEXT_PUBLIC_SANITY_PROJECT_ID` | Sanity project ID |
| `NEXT_PUBLIC_SANITY_DATASET` | Sanity dataset name |
| `S3_ENDPOINT` | S3-compatible storage endpoint |
| `ACCESS_KEY_ID` / `SECRET_ACCESS_KEY` | S3 credentials |

Production additionally needs: `NEXTAUTH_SECRET`, `S3_REGION`, `S3_BUCKET`, `S3_PUBLIC_BASE_URL`, `SITE_URL`.

### Admin Access in Dev

Visit `/admin/enable-admin` while logged in to grant yourself the ADMIN role. This route is a dev utility and should be disabled or removed in production.

### Running Tests

```bash
cd web
npm test                      # Run Jest tests
npm run lint                  # ESLint check
npm run lint-fix              # ESLint auto-fix
```

### CI/CD

GitHub Actions workflow at `.github/workflows/ci.yml` runs on push to main and on pull requests:
1. Install dependencies (`npm ci`)
2. Run linting (`npm run lint`)
3. Run tests (`npm test`)

## Working on This Project

### Adding a New Page

1. Create a directory under the appropriate route group in `src/app/`:
   - `(public)` for public pages (gets footer and GSAP)
   - `(dashboard)` for authenticated user pages (gets sidebar, requires login)
   - `(admin)` for admin pages (gets admin sidebar, requires ADMIN role)
2. Add a `page.tsx` file with a default export React component
3. Auth is handled by parent layouts — no need to add auth checks to individual pages
4. For admin pages, add `await checkAdminPermissions()` at the top of the page component for extra safety

### Adding a New API Endpoint

1. Create a new handler file under `src/app/api/v1/[[...route]]/`
2. Define a Hono router with your routes and Zod validation schemas
3. Register the handler in the main `route.ts` with `.route("/path", handler)`
4. Use `getServerSession()` for auth and `checkAdminPermissions()` for admin-only routes
5. The `AppType` export automatically provides type safety to the frontend API client

### Adding a Database Model

1. Edit `prisma/schema.prisma` to add your model
2. Run `npx prisma migrate dev --name describe-change` to create a migration
3. The Prisma client is auto-regenerated and available via `@/modules/prisma/lib/prisma-client`

### Adding a New Module

1. Create directory at `src/modules/<feature-name>/`
2. Add `lib/` for server-side logic (each function in its own directory with `index.ts` barrel export)
3. Add `components/` for React components
4. Add `hooks/` for client-side hooks
5. Add `constants.ts` for shared constants

### Adding a Blog Post

Use the admin interface at `/admin/blog/new`. See `web/docs/blogging.md` for details on the blogging system.

### Conventions

- **Module Organization**: Group related logic in `src/modules/<feature>/lib/<function-name>/` with an `index.ts` barrel export
- **Server Components by Default**: Pages and layouts are server components; add `"use client"` only when the component needs browser APIs, event handlers, or React hooks
- **Validation**: Use Zod schemas for all API input validation
- **Path Alias**: Use `@/` to reference `src/` (e.g., `@/modules/auth/lib/get-server-session`)
- **Formatting**: Prettier with default config; ESLint with Next.js core-web-vitals rules
- **Imports**: Prefer `@/` path aliases over relative imports for cross-module references
- **Testing**: Colocate tests with source files as `*.test.ts` or `*.test.tsx`
- **Cascade Deletes**: Most models cascade delete with their parent (User, Program, etc.)
