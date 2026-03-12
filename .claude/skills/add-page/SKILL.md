---
name: add-page
description: Create a new page following Next.js App Router conventions
argument-hint: <route-path>
disable-model-invocation: true
---

Create a new page at route `$ARGUMENTS`. Follow these steps:

1. Determine the correct route group:
   - `(public)` — public pages (gets footer and GSAP)
   - `(dashboard)` — authenticated user pages (gets sidebar, requires login)
   - `(admin)` — admin pages (gets admin sidebar, requires ADMIN role)
   - `(certificate)` — minimal layout (no nav, no footer)

2. Create `web/src/app/<route-group>/<path>/page.tsx` with a default export React component

3. Auth is handled by parent layouts. For admin pages, also add `await checkAdminPermissions()` at the top.

4. Use server components by default. Only add `"use client"` if the page needs browser APIs, event handlers, or React hooks.

5. Use MUI `sx` prop for styling. Follow the project's dark theme with orange primary (#F28D68).

6. Run `cd web && npm run lint` — no lint errors
