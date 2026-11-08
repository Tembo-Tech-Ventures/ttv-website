# CLAUDE.md

TTV Website is an Astro 7 SSR application for Tembo Tech Ventures, a tech training platform. Deployed on Cloudflare Workers with D1 (SQLite) and R2 (object storage). The main application code lives in `web/`.

## Quick Reference

```bash
cd web
npm ci --legacy-peer-deps     # Install deps (as CI does)
npm run dev                   # Start Astro dev server (port 4321)
npm run build                 # Build for production
npm run preview               # Preview production build locally
npm run db:generate           # Generate Drizzle migration from schema changes
npm run db:migrate:local      # Apply migrations to local D1
npm run lint                  # oxlint + ESLint
npm run typecheck             # tsc --noEmit
npm run typecheck:astro       # astro check
npm test                      # Run Vitest tests
```

**IMPORTANT**: All `npm` and `npx` commands MUST be run from the `web/` directory.

## Key Architecture Decisions

- **Path alias**: Use `@/` for `src/`. Example: `import * as schema from "@/lib/db/schema"`
- **Astro components by default**: Only use React (`.tsx`) with `client:visible` or `client:load` when the component needs browser APIs, hooks, or event handlers
- **UI kit and style guide**: Build UI from `@/components/platform/ui` (Button, ButtonLink, fields, Notice, EmptyState, Chip, Card, TabFile…), static in `.astro` files without a `client:` directive. Never hand-roll a button, field or alert. Principles, tokens, components, patterns and voice are in `web/docs/design-system/`; the public guide is `/style-guide`.
- **Middleware for auth**: Auth guards are in `src/middleware.ts`, not per-page. Dashboard requires login, admin requires ADMIN role.
- **Feature flags**: Platform features (spaces, onboarding, channels, Tembo in channels, mentor requests) ship dark behind DB-backed flags; a page or API whose flag is off for the caller returns 404. Access comes from `capabilitiesFor` / `channelAccessFor`. See `web/docs/platform-spaces-and-channels.md`.
- **Astro pages**: All pages are `.astro` files in `src/pages/`. Forms use standard HTML `<form method="POST">` with server-side handling in frontmatter.
- **Styling**: Tailwind CSS 4 with custom theme in `src/styles/global.css`. Colors: orange primary (#F28D68), dark teal (#013D39), lighter teal (#2C6964)
- **Fonts**: Mattone Black (the h1 by default, and the public site's display h2s through `font-display`; self-hosted from `src/assets/fonts/`, OFL 1.1), Maven Pro (body and h2-h6, also self-hosted there, OFL 1.1; layouts preload it with `FontPreload`). No third-party font origin. Display tracking comes from the `--tracking-display` / `--tracking-heading` / `--tracking-subhead` theme tokens — use `tracking-*` utilities, not inline `letter-spacing`.
- **Database**: Drizzle ORM + SQLite via Cloudflare D1. Schema in `src/lib/db/schema.ts`.
- **Icons**: Phosphor Icons (`@phosphor-icons/react`) for homepage, react-icons (`react-icons/pi`) for admin/dashboard shells

## Authentication

GitHub OAuth via better-auth. Session-based, stored in D1.

- Middleware (`src/middleware.ts`) — attaches `locals.user`, `locals.session`, `locals.isAdmin` to every request
- `createAuth(env)` — creates per-request auth instance (Cloudflare bindings are request-scoped)
- `authClient` (`src/lib/auth-client.ts`) — client-side auth helpers (`signIn`, `signOut`, `useSession`)
- Protected routes: `/dashboard/*` requires login, `/admin/*` requires ADMIN role

## Database Access Pattern

```astro
---
import { drizzle } from "drizzle-orm/d1";
import { env } from "cloudflare:workers";
import * as schema from "@/lib/db/schema";

const db = drizzle(env.DB, { schema });
const users = await db.query.user.findMany();
---
```

## Form Handling Pattern

Astro pages handle forms server-side in the frontmatter:

```astro
---
let error = "";
let success = "";

if (Astro.request.method === "POST") {
  const formData = await Astro.request.formData();
  const name = formData.get("name") as string;
  // validate, then insert/update via Drizzle
}
---
<form method="POST">
  <input name="name" />
  <button type="submit">Save</button>
</form>
```

## Environment

- Dev: `npm run dev` starts Astro dev server on port 4321 with local D1 via Wrangler
- Dev env vars in `web/.env`
- Production: Cloudflare Workers with D1 database, R2 storage
- Production secrets: `BETTER_AUTH_SECRET`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`
- Domain redirect: `www.tembotechventures.com` → `tembotechventures.com` (handled in middleware)

## Reference

@ARCHITECTURE.md
