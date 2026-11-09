# Pages in spaces (U-1.2)

The existing dashboard pages, rendered inside the spaces shell (U-1.1) when
the `spaces` flag is on for the person. The page files stay where they are:
B-1.2 serves them at their canonical space paths (`/dashboard/cohort/apply`
renders `pages/dashboard/apply.astro`), redirects the old URLs, and guards
access. This module only changes the frame around each page.

## How a page opts in

```astro
---
const spaces = await resolveSpacePage(Astro.locals, "apply");
---
<SpacePage context={spaces} title="Apply to a cohort">
  <PageHeader title="Apply to a cohort">…</PageHeader>
  …the page…
</SpacePage>
```

- `resolveSpacePage` returns `{ me, space, page }`, or `null` when there is no
  spaces context: the flag is off for the person, the caller is a personal
  access token (`Me` is browser-only), or the space context could not load.
  Canonical routes fail closed in the middleware first, so `null` reaches only
  legacy addresses. It never grants anything; the page and its APIs still authorise.
- `PAGE_SPACES` (sidebar.ts) says which space each page opens in. Applying and
  Ask Tembo open in Cohort, or in Community for someone without a cohort; the
  admin mentor review opens in Admin for staff who are not mentors.
- `SpacePage` renders `SpacesLayout` with the space's sidebar, or `PlainFrame`
  without a context: the page on a sheet with the TEMBO mark home and, for a
  browser session, a way to sign out, and no `Me` (decision D2). `AdminLayout`
  does the same, with the admin navigation as `PlainFrame`'s sidebar
  (`adminSidebar`). The old `DashboardLayout`, `DashboardShell` and `AdminShell`
  are gone (X1).
- Every page takes its title from the kit: `PageTitle` or `PageHeader` from
  `@/components/platform/ui`.
- Full-height views (Ask Tembo) pass `fill`, so they size to the sheet.
- Search and attention overlays (U-1.3) mount in `SpacePage`, the one place, so every space page has Ctrl K and the bell.

## Sidebars

`spaceSidebar(space, facts)` is the data for each sidebar. It links only to
pages that exist, at their canonical paths, shows what the journey has
unlocked (as the old sidebar did), and drops links a restricted synthetic
identity may not follow. Mentor requests and availability are labelled as not
open yet and point at the Mentoring overview, which says what they will be.
A member without a cohort gets the way to apply in Community, on the page
itself (`CohortInvitation`) as well as in the sidebar.

While `channels` is on for the person, Community and Cohort also list their
channels (U-2.3, `components/channels/README.md`).

## Styling moved-in pages

The old dashboard tuned its status colours for a darker ground. Inside the
sheet (`spaces-shell.css`) section h2s use Maven Pro, peach text uses the
peach ink, and Tailwind's 300 and 400 status tints step one lighter, so text
keeps 4.5:1.

## Tests

- `npx vitest run src/components/platform/spaces`
- `e2e/platform-personas.spec.ts`: every space and every sidebar destination
  for each persona at 1440 and 390 px, with axe, keyboard, reduced motion, no
  sideways scrolling, the no-cohort apply journey (also without JavaScript),
  Ask Tembo, mentoring, staff and a form post. Sessions are signed cookies
  (`e2e/platform-personas.ts`). On agent previews it uses the preview's
  student personas and agent; mentor and institution run locally:

  ```sh
  npx wrangler d1 execute ttv-database --local --file e2e/platform-personas.local.sql
  # .dev.vars: BETTER_AUTH_SECRET=<secret>, PLATFORM_FLAGS_OVERRIDE=all
  PLATFORM_PERSONAS_LOCAL_SECRET=<secret> npx playwright test e2e/platform-personas.spec.ts
  ```
