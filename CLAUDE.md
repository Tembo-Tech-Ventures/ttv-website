# CLAUDE.md

This file provides context for Claude Code when working on the TTV Website project.

## Project Overview

TTV Website is a Next.js 14 (App Router) full-stack application for a tech training platform. The main application code lives in `web/`. See `ARCHITECTURE.md` for a full architectural overview.

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

## Project Structure

- `web/src/app/` - Next.js App Router pages, layouts, and API routes
- `web/src/modules/` - Feature modules (auth, blog, analytics, roles, prisma, s3, mui, gsap, api)
- `web/src/components/` - Shared UI components
- `web/prisma/schema.prisma` - Database schema (PostgreSQL)
- `web/sanity/` - Sanity CMS schemas
- `web/compose.yaml` - Docker services for local dev

## Route Groups

The app uses Next.js route groups (parenthesized folders) for layout separation:
- `(public)` - Public pages with footer
- `(admin)` - Admin dashboard with sidebar (requires ADMIN role)
- `(dashboard)` - User dashboard with sidebar (requires auth)
- `(certificate)` - Certificate display

## Key Patterns

### Module Organization
Business logic goes in `src/modules/<feature>/lib/<function-name>/` with an `index.ts` barrel export. Components in `src/modules/<feature>/components/`, hooks in `src/modules/<feature>/hooks/`.

### Path Alias
Use `@/` to reference `src/`. Example: `import { getServerSession } from "@/modules/auth/lib/get-server-session"`

### Authentication
- `getServerSession()` - Get session on the server
- `getAccess()` - Get session or redirect to login
- `checkAdminPermissions()` - Throw if not admin
- `isAdmin()` - Boolean admin check

### API Routes
REST API uses Hono at `/api/v1/[[...route]]`. Validate with `zValidator` + Zod schemas. Auth via `getServerSession()`. Admin checks via `checkAdminPermissions()`.

### Database
Prisma ORM with PostgreSQL. Schema at `web/prisma/schema.prisma`. To add a migration: `npx prisma migrate dev --name describe-change`. The Prisma client singleton is at `@/modules/prisma/lib/prisma-client`.

### Styling
MUI 5 with custom theme. Colors: orange primary (#F28D68), dark teal (#013D39), lighter teal (#2C6964). Fonts: Climate Crisis (headings), Maven Pro (body). Use MUI `sx` prop for styling. GSAP ScrollTrigger for homepage animations.

### Server vs Client Components
Pages and layouts are server components by default. Add `"use client"` directive only when the component needs browser APIs, event handlers, or hooks.

## Environment

Dev environment variables are in `web/.env`. Key ones:
- `POSTGRES_PRISMA_URL` - Database connection
- `EMAIL_SERVER` / `EMAIL_FROM` - SMTP for auth emails
- `NEXTAUTH_URL` - App URL
- `S3_ENDPOINT` / `ACCESS_KEY_ID` / `SECRET_ACCESS_KEY` - File storage
- `NEXT_PUBLIC_SANITY_PROJECT_ID` / `NEXT_PUBLIC_SANITY_DATASET` - CMS

## Testing

Jest with Testing Library. Tests live alongside source files (`*.test.ts`). Run `npm test` from `web/`.

## Common Tasks

### Add a new page
Create `src/app/(route-group)/path/page.tsx`. Auth is handled by parent layouts.

### Add an API endpoint
Add route under `src/app/api/v1/[[...route]]/` and register in the Hono app. Use Zod validation.

### Add a database model
Edit `prisma/schema.prisma`, run `npx prisma migrate dev --name describe-change`.

### Get admin access in dev
Log in, then visit `/admin/enable-admin`.

## Important Notes

- The `web/` directory is the working directory for all npm commands
- Docker Compose must be running for local dev (Postgres on 5432, Mailhog on 8025/1025, S3Mock on 9090)
- Migrations auto-run on `npm run dev` and during build
- Blog images are resized to 1200px width before S3 upload
- Application form data is stored as a JSON blob in the `ProgramApplication.application` field
