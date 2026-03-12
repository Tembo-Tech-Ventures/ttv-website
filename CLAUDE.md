# CLAUDE.md

TTV Website is a Next.js 14 (App Router) full-stack application for Tembo Tech Ventures, a tech training platform. The main application code lives in `web/`.

## Quick Reference

```bash
cd web
docker compose up -d          # Start local services (Postgres, Mailhog, S3Mock)
npm install                   # Install deps + prisma generate
npm run dev                   # Run migrations + start dev server (port 3000)
npm test                      # Run Jest tests
npm run lint                  # ESLint
npm run lint-fix              # ESLint with auto-fix
npx prisma migrate dev --name describe-change  # Create migration
```

**IMPORTANT**: All `npm` and `npx` commands MUST be run from the `web/` directory.

## Key Architecture Decisions

- **Path alias**: Use `@/` for `src/`. Example: `import { prisma } from "@/modules/prisma/lib/prisma-client"`
- **Server components by default**: Only add `"use client"` when the component needs browser APIs, hooks, or event handlers
- **No middleware.ts**: Auth guards are at the layout/page level, not via Next.js middleware
- **Module structure**: Business logic in `src/modules/<feature>/` with `lib/`, `components/`, `hooks/` subdirs
- **Server actions**: Mutations use Next.js server actions in `src/app/actions/`. No REST API layer.
- **Styling**: MUI 5 `sx` prop preferred. Colors: orange primary (#F28D68), dark teal (#013D39), lighter teal (#2C6964)
- **Fonts**: Climate Crisis (headings), Maven Pro (body)
- **Tests**: Jest + Testing Library, colocated as `*.test.ts(x)`. Mocks in `src/__mocks__/`

## Authentication

Email-only passwordless via NextAuth 4. Magic links → PostgreSQL sessions via PrismaAdapter.

- `getServerSession()` — typed server session (includes `user.id`, `user.emailVerified`)
- `checkAdminPermissions()` — throws if not ADMIN (use in API routes and admin pages)
- `isAdmin()` — boolean admin check (use for conditional UI)
- `useLoginRedirect()` — client hook, redirects unauthenticated users to `/auth/login`

## Server Actions

Server actions live in `src/app/actions/`. Each action file is marked `"use server"`.

- Auth: `getServerSession()` → throw if no session
- Admin: `checkAdminPermissions()` → throws on unauthorized
- After mutations: call `revalidatePath()` to refresh Next.js cache
- Frontend calls server actions directly (no fetch/REST needed)

## Environment

Docker Compose must be running for local dev (PostgreSQL :5432, Mailhog :8025/:1025, S3Mock :9090).
Dev env vars in `web/.env`. Production also needs: `NEXTAUTH_SECRET`, `S3_REGION`, `S3_BUCKET`, `S3_PUBLIC_BASE_URL`, `SITE_URL`.

## Reference

@ARCHITECTURE.md
