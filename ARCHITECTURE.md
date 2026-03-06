# TTV Website Architecture

This document describes the architecture, technology choices, and conventions used in the TTV Website project. It is intended for developers onboarding to the codebase or returning after time away.

## Overview

TTV Website is a full-stack web application for Tembo Tech Ventures, a tech training platform. It supports public marketing pages, a blogging system, user authentication, a student application workflow, curriculum delivery via a headless CMS, admin dashboards, certificate generation, and file uploads.

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
│   │   │   │   ├── admin/        # Admin-only endpoints
│   │   │   │   └── file/         # File upload
│   │   │   └── content-studio/   # Embedded Sanity CMS
│   │   ├── components/           # Shared UI components (Card, Link)
│   │   ├── modules/              # Feature modules (see below)
│   │   ├── providers/            # React context providers
│   │   ├── types/                # Shared TypeScript types
│   │   └── assets/               # Static assets (logos)
│   ├── prisma/
│   │   ├── schema.prisma         # Database schema
│   │   ├── seed.ts               # Seed script
│   │   └── migrations/           # Migration history
│   ├── sanity/                   # Sanity CMS schemas and config
│   ├── public/                   # Static files served by Next.js
│   ├── docs/                     # Feature documentation
│   ├── compose.yaml              # Docker services for dev
│   └── package.json
├── .devcontainer/                # GitHub Codespaces / devcontainer config
└── .vscode/                      # Editor settings
```

## Modules (`src/modules/`)

The project organizes business logic into feature modules under `src/modules/`. Each module contains a combination of `lib/` (server-side logic, data access), `components/` (React components), and `hooks/` (client-side hooks).

| Module | Purpose |
|--------|---------|
| `analytics/` | RudderStack page tracking and event identification |
| `api/` | Hono API client setup |
| `auth/` | Session helpers (`getServerSession`, `getAccess`), email login form, redirect hook |
| `blog/` | CRUD operations for blog posts, image upload, RSS generation |
| `gsap/` | GSAP ScrollTrigger initialization |
| `mui/` | MUI theme definition and ThemeProvider |
| `prisma/` | Prisma client singleton |
| `roles/` | Admin/educator role checks (`isAdmin`, `checkAdminPermissions`, `enableAdmin`) |
| `s3/` | S3 client configuration |

## Routing

The project uses Next.js App Router with **route groups** (parenthesized folders) to apply different layouts without affecting URL paths.

### Layout Hierarchy

```
Root Layout (SessionProvider + MUI ThemeProvider)
├── (public)  → Footer, GSAP ScrollTrigger
│   └── (home)/page.tsx  →  /
├── (admin)   → Admin sidebar drawer, admin auth check
│   └── admin/*
├── (dashboard) → User sidebar drawer, auth check
│   └── dashboard/*
├── (certificate) → Minimal layout
│   └── certificate/[application-id]
├── auth/*    → Login, register, verify, logout
├── blog/*    → Public blog
└── api/*     → API endpoints (no layout)
```

### Key Routes

| Path | Purpose |
|------|---------|
| `/` | Public homepage |
| `/blog` | Blog index |
| `/blog/[slug]` | Individual blog post |
| `/blog/rss.xml` | RSS feed |
| `/auth/login` | Email login |
| `/auth/register` | Registration |
| `/dashboard` | User dashboard home |
| `/dashboard/apply` | Apply to a program |
| `/dashboard/application/[id]` | View/edit application |
| `/dashboard/profile` | User profile |
| `/dashboard/curriculum` | Curriculum content |
| `/admin` | Admin dashboard |
| `/admin/user` | User management |
| `/admin/application` | Application review |
| `/admin/program` | Program management |
| `/admin/blog` | Blog post management |
| `/admin/blog/new` | Create blog post |
| `/admin/blog/[slug]/edit` | Edit blog post |
| `/certificate/[id]` | Certificate display |
| `/content-studio` | Sanity CMS studio |

## API Design

REST API endpoints are built with **Hono** mounted as a Next.js catch-all route at `/api/v1/[[...route]]`. Hono provides middleware, routing, and Zod-based request validation via `@hono/zod-validator`.

### API Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `/api/v1/program-application` | POST | User | Create application |
| `/api/v1/program-application/:id` | PUT | User | Update own application |
| `/api/v1/program-application/:id/admin` | PUT | Admin | Admin update application |
| `/api/v1/program-partner` | GET | User | List partners |
| `/api/v1/program-role` | POST | Admin | Assign instructor/TA |
| `/api/v1/program-role/:id` | DELETE | Admin | Remove role assignment |
| `/api/v1/user` | PUT | User | Update own profile |
| `/api/v1/user/:id/admin` | PUT | Admin | Admin update user |
| `/api/file` | POST | User | Get signed S3 upload URL |
| `/api/admin/blog/upload` | POST | Admin | Upload blog image |

## Database

PostgreSQL with Prisma ORM. The schema lives at `web/prisma/schema.prisma`.

### Core Models

- **User, Account, Session, VerificationToken** - NextAuth authentication models
- **Role, UserRole** - Role-based access (ADMIN, EDUCATOR roles)
- **Program, Curriculum** - Training programs linked to curricula
- **ProgramRole** - Instructor/TA assignments (enum: INSTRUCTOR, TA)
- **ProgramPartner** - Partner organizations
- **ProgramApplication** - Student applications with status workflow (PENDING → APPROVED → COMPLETED, or REJECTED/AUDIT)
- **File** - Uploaded file metadata
- **BlogPost** - Blog posts with title, slug, markdown content, author

### Migrations

There are 16 migrations in `prisma/migrations/`. Migrations auto-run on `npm run dev` and during build. For production, run `npm run migrate:deploy` after database provisioning.

## Authentication

NextAuth 4 with **email-only passwordless** login. Users enter their email, receive a magic link (valid 10 minutes), and click to authenticate. Sessions are stored in the database via PrismaAdapter.

Key auth utilities:
- `getServerSession()` at `@/modules/auth/lib/get-server-session` - server-side session retrieval
- `getAccess()` at `@/modules/auth/lib/get-access` - session + redirect if unauthenticated
- `checkAdminPermissions()` at `@/modules/roles/lib/check-admin-permissions` - throws if not admin
- `isAdmin()` at `@/modules/roles/lib/is-admin` - boolean admin check

## Features

### Blogging

Admin users create/edit posts at `/admin/blog` using a Markdown editor. Posts are stored in PostgreSQL. Images are uploaded to S3 and resized to 1200px width via Sharp. Public blog at `/blog` renders markdown with `react-markdown`. RSS feed at `/blog/rss.xml`. See `web/docs/blogging.md` for details.

### Program Applications

Students apply to programs through a dynamic form at `/dashboard/apply`. The form schema supports text, textarea, boolean, number, and date fields. Applications are stored as JSON blobs. Admins review at `/admin/application` and transition status: PENDING → APPROVED/REJECTED/AUDIT → COMPLETED.

### Certificates

When an application is marked COMPLETED, a certificate is generated at `/certificate/[application-id]` showing the student name, curriculum title, certificate ID, completion date, and instructor name.

### Curriculum & Content

Curriculum content is managed through Sanity CMS (headless). The Sanity studio is embedded at `/content-studio`. Schemas define Course, Chapter, and Lesson document types. Content is fetched via GROQ queries using `next-sanity`.

### File Uploads

Files are uploaded via signed S3 URLs. The client requests a signed URL from `/api/file`, then uploads directly to S3. File metadata (name, type, size, path) is stored in Prisma. Max file size: 2MB.

## Styling

- **MUI Theme**: Custom dark theme with orange primary (#F28D68), dark teal (#013D39), and lighter teal (#2C6964)
- **Typography**: Climate Crisis font for headings, Maven Pro for body text
- **Component Styling**: MUI `sx` prop for most styling, styled-components for custom components
- **Animations**: GSAP ScrollTrigger on public homepage elements

## Development Setup

### Prerequisites

- Node.js
- Docker (for local PostgreSQL, Mailhog, S3Mock)

### Getting Started

```bash
cd web
docker compose up -d          # Start PostgreSQL, Mailhog, S3Mock
npm install                   # Install dependencies (runs prisma generate)
npm run dev                   # Run migrations + start dev server
```

### Local Services (via Docker Compose)

| Service | Port | Purpose |
|---------|------|---------|
| PostgreSQL 16 | 5432 | Database |
| Mailhog | 8025 (UI), 1025 (SMTP) | Email testing |
| S3Mock | 9090 | S3-compatible file storage |

### Environment Variables

Development defaults are configured in `web/.env`. Key variables:

| Variable | Purpose |
|----------|---------|
| `POSTGRES_PRISMA_URL` | PostgreSQL connection string |
| `EMAIL_SERVER` | SMTP connection string |
| `EMAIL_FROM` | Sender email address |
| `NEXTAUTH_URL` | Application URL (auto-configured for Codespaces) |
| `NEXT_PUBLIC_SANITY_PROJECT_ID` | Sanity project ID |
| `NEXT_PUBLIC_SANITY_DATASET` | Sanity dataset name |
| `S3_ENDPOINT` | S3-compatible storage endpoint |
| `ACCESS_KEY_ID` / `SECRET_ACCESS_KEY` | S3 credentials |

Production additionally needs: `NEXTAUTH_SECRET`, `S3_REGION`, `S3_BUCKET`, `S3_PUBLIC_BASE_URL`, `SITE_URL`.

### Admin Access in Dev

Visit `/admin/enable-admin` while logged in to grant yourself the ADMIN role.

### Running Tests

```bash
cd web
npm test
```

## Working on This Project

### Adding a New Page

1. Create a directory under the appropriate route group in `src/app/` (`(public)`, `(admin)`, or `(dashboard)`)
2. Add a `page.tsx` file with a default export React component
3. If it needs auth, the parent layout already handles it; for admin, `checkAdminPermissions()` is called in the layout

### Adding a New API Endpoint

1. For RESTful endpoints, add a new route file under `src/app/api/v1/[[...route]]/` and register it in the Hono app
2. Use `zValidator` for request validation with Zod schemas
3. Use `getServerSession()` for auth and `checkAdminPermissions()` for admin-only routes

### Adding a Database Model

1. Edit `prisma/schema.prisma`
2. Run `npx prisma migrate dev --name describe-change` to create a migration
3. The Prisma client is auto-regenerated

### Adding a Blog Post

Use the admin interface at `/admin/blog/new`. See `web/docs/blogging.md`.

### Conventions

- **Module Organization**: Group related logic in `src/modules/<feature>/lib/<function-name>/` with an index file
- **Server Components by Default**: Pages and layouts are server components; add `"use client"` only when needed
- **Validation**: Use Zod schemas for all API input validation
- **Path Alias**: Use `@/` to reference `src/` (e.g., `@/modules/auth/lib/get-server-session`)
- **Formatting**: Prettier with default config; ESLint with Next.js rules
