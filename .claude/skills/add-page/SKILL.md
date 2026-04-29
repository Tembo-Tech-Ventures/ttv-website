---
name: add-page
description: Create a new Astro page following project conventions
argument-hint: <route-path>
disable-model-invocation: true
---

Create a new page at route `$ARGUMENTS`. Follow these steps:

1. Determine the correct layout:
   - `PublicLayout` — public marketing pages (nav, footer, grain overlay)
   - `DashboardLayout` — authenticated user pages (sidebar shell, requires login via middleware)
   - `AdminLayout` — admin pages (admin sidebar shell, requires ADMIN role via middleware)
   - `CertificateLayout` — minimal layout (no nav, no footer)

2. Create `web/src/pages/<path>.astro` (or `web/src/pages/<path>/index.astro` for directory routes)

3. Use the appropriate layout:
   ```astro
   ---
   import AdminLayout from "@/layouts/AdminLayout.astro";
   ---
   <AdminLayout title="Page Title">
     <!-- content -->
   </AdminLayout>
   ```

4. Auth is handled by middleware (`src/middleware.ts`):
   - `/dashboard/*` routes require authentication
   - `/admin/*` routes require ADMIN role
   - Access `Astro.locals.user` and `Astro.locals.session` for user data

5. For database access, use Drizzle ORM:
   ```astro
   ---
   import { drizzle } from "drizzle-orm/d1";
   import { env } from "cloudflare:workers";
   import * as schema from "@/lib/db/schema";
   const db = drizzle(env.DB, { schema });
   ---
   ```

6. Use Astro components by default. Only use React (`.tsx`) with `client:visible` or `client:load` when the component needs browser APIs, event handlers, or React hooks.

7. Style with Tailwind CSS using the project's theme variables (`text-primary`, `bg-dark`, `text-ink-primary`, etc.)

8. For forms, use standard HTML `<form method="POST">` with server-side handling in the page frontmatter.

9. Run `cd web && npm run lint` — no lint errors
