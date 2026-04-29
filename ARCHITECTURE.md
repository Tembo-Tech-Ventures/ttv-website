# TTV Website Architecture

This document describes the architecture, technology choices, and conventions used in the TTV Website project.

## Overview

TTV Website is a full-stack web application for **Tembo Tech Ventures**, a tech training platform. It supports:

- **Public marketing pages** with animated hero sections and GSAP animations
- **User authentication** via GitHub OAuth (better-auth)
- **Student application workflow** with dynamic forms and status tracking
- **Admin dashboards** for managing users, applications, and programs
- **Certificate generation** for completed programs
- **Blog** (placeholder — CMS not yet re-implemented)

The entire application lives inside the `web/` directory as a single Astro project deployed to Cloudflare Workers.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Astro 6 (SSR, Cloudflare adapter) |
| Language | TypeScript 5 |
| UI Islands | React 18 (for interactive components) |
| CSS | Tailwind CSS 4 (Vite plugin) |
| Animations | GSAP + ScrollTrigger |
| Database | SQLite via Cloudflare D1 |
| ORM | Drizzle ORM |
| Authentication | better-auth (GitHub OAuth) |
| File Storage | Cloudflare R2 |
| Icons | Phosphor Icons, react-icons |
| ID Generation | CUID2 |
| Deployment | Cloudflare Workers |
| CI/CD | GitHub Actions |

## Directory Structure

```
ttv-website/
├── web/                          # The Astro application
│   ├── src/
│   │   ├── pages/                # File-based routing (Astro pages)
│   │   │   ├── admin/            # Admin dashboard pages
│   │   │   ├── auth/             # Login, logout
│   │   │   ├── blog/             # Blog (placeholder)
│   │   │   ├── certificate/      # Certificate display
│   │   │   ├── dashboard/        # User dashboard pages
│   │   │   ├── api/              # API routes
│   │   │   │   ├── auth/         # better-auth handler
│   │   │   │   └── admin/        # Admin API (data import)
│   │   │   └── index.astro       # Homepage
│   │   ├── layouts/              # Astro layouts
│   │   │   ├── BaseLayout.astro  # Root HTML shell
│   │   │   ├── PublicLayout.astro # Marketing pages (nav + footer)
│   │   │   ├── AdminLayout.astro  # Admin pages (sidebar shell)
│   │   │   ├── DashboardLayout.astro # User dashboard (sidebar shell)
│   │   │   └── CertificateLayout.astro # Minimal layout
│   │   ├── components/           # Reusable components
│   │   │   ├── auth/             # Auth components (GitHubSignInButton)
│   │   │   ├── common/           # Shared UI (Button, Input, Table, Card, Badge, Sidebar)
│   │   │   ├── homepage/         # Homepage sections (Hero, Features, Values, etc.)
│   │   │   └── shells/           # Layout shells (AdminShell, DashboardShell)
│   │   ├── lib/                  # Core libraries
│   │   │   ├── auth.ts           # better-auth server config
│   │   │   ├── auth-client.ts    # better-auth client helpers
│   │   │   └── db/
│   │   │       ├── schema.ts     # Drizzle schema (all models)
│   │   │       └── migrations/   # D1 migration SQL files
│   │   ├── styles/
│   │   │   └── global.css        # Tailwind config + theme
│   │   ├── middleware.ts         # Auth middleware (session + route guards)
│   │   └── env.d.ts              # TypeScript declarations
│   ├── scripts/
│   │   ├── cloudflare/           # Deploy/destroy scripts
│   │   └── import-data.mjs       # Data migration from old Prisma stack
│   ├── astro.config.mjs          # Astro configuration
│   ├── drizzle.config.ts         # Drizzle ORM config
│   ├── wrangler.jsonc            # Cloudflare Workers config
│   └── package.json
├── .github/workflows/            # CI/CD workflows
├── .claude/                      # Claude Code skills and settings
└── .devcontainer/                # GitHub Codespaces config
```

## Routing

Astro uses file-based routing in `src/pages/`. Layouts provide shared UI shells.

### Layout Hierarchy

```
BaseLayout (HTML shell, global CSS, meta tags)
├── PublicLayout  → Nav bar, footer, grain overlay, gradient background
│   └── index.astro  →  /  (animated hero, features, values, cohort)
├── AdminLayout   → AdminShell (React island with sidebar)
│   └── admin/*  (users, applications, programs, data-migration)
├── DashboardLayout → DashboardShell (React island with sidebar)
│   └── dashboard/*  (apply, applications, profile)
├── CertificateLayout → Minimal (no nav, no footer)
│   └── certificate/[id].astro
├── (no layout) → auth/*, blog/*, api/*
```

### Key Routes

| Path | Purpose | Auth |
|------|---------|------|
| `/` | Public homepage with animated sections | None |
| `/blog` | Blog placeholder | None |
| `/auth/login` | GitHub OAuth sign-in | None |
| `/auth/logout` | Sign out | Session |
| `/dashboard` | User dashboard home | Session |
| `/dashboard/apply` | Program application form | Session |
| `/dashboard/application/[id]` | View/edit own application | Session |
| `/dashboard/profile` | User profile | Session |
| `/admin` | Admin dashboard home | ADMIN |
| `/admin/users` | User management | ADMIN |
| `/admin/users/[id]` | User detail (roles) | ADMIN |
| `/admin/applications` | Application review | ADMIN |
| `/admin/applications/[id]` | Application detail, status changes | ADMIN |
| `/admin/programs` | Program management | ADMIN |
| `/admin/programs/[id]` | Program detail, role assignments | ADMIN |
| `/admin/programs/new` | Create program | ADMIN |
| `/admin/data-migration` | Import data from old stack | ADMIN |
| `/certificate/[id]` | Certificate display | None |
| `/api/auth/[...all]` | better-auth API handler | N/A |
| `/api/admin/import` | Data import API | ADMIN |

## Database

SQLite via Cloudflare D1, managed with Drizzle ORM. Schema at `web/src/lib/db/schema.ts`.

### Core Models

**Authentication (better-auth)**
- `user` — id, name, email, emailVerified, image
- `account` — OAuth provider linking (cascade deletes with User)
- `session` — database-backed sessions (cascade deletes with User)
- `verification` — email verification tokens

**Authorization**
- `Roles` — role definitions (ADMIN, EDUCATOR)
- `UserRoles` — many-to-many user-role assignments

**Programs & Curriculum**
- `curriculum` — training curriculum (title, description)
- `program` — training program with dates, linked to Curriculum
- `programRole` — instructor/TA assignments (enum: INSTRUCTOR, TA)
- `programPartner` — partner organizations

**Applications**
- `programApplication` — student applications
  - `status`: PENDING → APPROVED/REJECTED/AUDIT → COMPLETED
  - `application`: JSON text storing form responses
  - `completedAt`: set when status becomes COMPLETED

**Files**
- `file` — uploaded file metadata (name, type, size, path, ownerId)

### Conventions

- All tables use CUID2 for primary keys (via `cuid()` helper)
- Timestamps use `integer({ mode: "timestamp" })` with `unixepoch()` default
- Relations defined with `relations()` from drizzle-orm
- Cascade deletes on auth-related tables (account, session, userRole)

## Authentication

GitHub OAuth via **better-auth**:

1. User clicks "Sign in with GitHub" on `/auth/login`
2. better-auth handles OAuth flow via `/api/auth/[...all]`
3. Session created in D1 with 5-minute cookie cache
4. Middleware attaches `locals.user` and `locals.session` on every request

**Auth flow in middleware (`src/middleware.ts`):**
- Every request: resolve session from cookies via better-auth
- `/dashboard/*`: redirect to `/auth/login` if no session
- `/admin/*`: redirect to `/auth/login` if no session, redirect to `/dashboard` if no ADMIN role

## Styling

- **Tailwind CSS 4**: Custom theme defined in `src/styles/global.css` using `@theme` directive
- **Color tokens**: `--color-primary` (#F28D68), `--color-dark` (#013D39), `--color-teal` (#2C6964), `--color-bg-raised`, `--color-ink-primary`, `--color-ink-secondary`, `--color-ink-muted`, `--color-rule`
- **Typography**: Climate Crisis for h1/h2, Maven Pro for body and h3-h6
- **Animations**: GSAP ScrollTrigger on homepage sections, CSS-only marquee, reveal utility class
- **Grain overlay**: SVG noise texture via `Grain.astro` component

## Deployment

### Cloudflare Workers via GitHub Actions

- **Production**: Auto-deploys on push to `main` → `tembotechventures.com`
- **Staging**: Auto-deploys on PR → `staging.tembotechventures.com`
- **Manual**: Workflow dispatch for arbitrary environments

### Deployment scripts (`scripts/cloudflare/`)

- `deploy.mjs` — Creates D1 database, R2 bucket, applies migrations, deploys Worker, configures domain
- `destroy.mjs` — Tears down environment (protected against production)
- `lib.mjs` — Shared Cloudflare API utilities

### Local Development

```bash
cd web
npm install
npm run dev          # Starts Astro dev server with local D1
```

No Docker needed. Wrangler handles local D1 database emulation.

## Working on This Project

### Adding a New Page

1. Create `src/pages/<path>.astro` (or `src/pages/<path>/index.astro`)
2. Import and wrap with the appropriate layout (`PublicLayout`, `DashboardLayout`, `AdminLayout`)
3. Auth is handled by middleware — no need for per-page auth checks
4. Access database via `drizzle(env.DB, { schema })`
5. Use Astro components by default; React islands only for interactivity

### Adding a Database Model

1. Edit `src/lib/db/schema.ts`
2. Run `cd web && npm run db:generate` to create migration
3. Run `cd web && npm run db:migrate:local` to apply locally
4. Migrations auto-apply on deploy via `scripts/cloudflare/deploy.mjs`

### Adding an API Endpoint

1. Create `src/pages/api/<path>.ts`
2. Export HTTP method handlers (`GET`, `POST`, etc.) as `APIRoute`
3. Auth via `createAuth(env).api.getSession({ headers: request.headers })`
4. Database via `drizzle(env.DB, { schema })`

### Conventions

- **Astro first**: Use `.astro` for pages and static components. React `.tsx` only for interactivity.
- **`client:visible`** for below-fold interactive content, **`client:load`** for above-fold
- **Path alias**: `@/` for `src/` in imports
- **Common components**: Use `Button`, `Input`, `Table`, `Card`, `Badge`, `Sidebar` from `src/components/common/`
- **Theme colors**: Use Tailwind classes (`text-primary`, `bg-dark`, `text-ink-primary`, etc.)
