# Space routing (B-1.2)

`space-routes.ts` is a pure path map with type-only imports. It is safe to import
`SPACE_PATHS` from the shell. Paths do not grant authority.

- `SPACE_PATHS: Record<SpaceId, string>`: cohort, community, mentoring, discover,
  admin and profile entry URLs. Profile is `/dashboard/me`; account is
  `/dashboard/account`.
- `SPACE_REDIRECTS`: the complete legacy-to-canonical route table. `:id` matches
  one opaque segment, including `writing/new`.
- `canonicalSpacePath(pathname): string | null`: the canonical target for a
  recognized legacy path, without query parameters.
- `legacySpacePath(pathname): string`: the existing rendering/allowlist target
  for a canonical alias; otherwise the normalized input path.
- `spaceForPath(pathname): SpaceId | null`: URL context, never authorization.

`routeSpaceRequest(context, next)` runs after authentication and all existing
demo, QA, fixture and delegation boundaries. It also runs in the separate QA
authentication branch. `getSpaceContext(context)` reuses its `Me` promise for
the same request locals and identity, so a later layout call does not reload it.
Only `Me` is serializable; never pass locals, Request, Cookie headers, session or
auth objects into islands.

When `spaces` is OFF, existing URLs and form handlers continue unchanged. New
prefixes return 404. On space-context database failure, only unchanged legacy
handlers run, after all existing authentication, PAT, demo and fixture boundaries.
No rewrite, redirect or preference cookie is generated. Canonical routes fail
closed through the existing middleware error observer.

When ON, recognized legacy GET/HEAD URLs return 301 with their query string
preserved. `/dashboard` uses a non-cacheable 302 to the authorized last-space
cookie or first ordered space, filtered through any restricted identity's
existing allowlist (onboarding adds to this choice; see below). Explicit authorized URLs win over cookies; forbidden URLs
return 403 rather than falling back. Applying at `/dashboard/cohort/apply`
remains possible before cohort membership, as does signed-in Ask AI at
`/dashboard/cohort/ask`. These are page eligibility exceptions only: they do not
grant cohort membership, recording access or AI retrieval scope. Existing API
and data permissions remain authoritative (coordinator decision, 2026-10-31).
Admin mentor review retains its existing page permission without adding mentoring
membership or persisting a mentoring cookie. PAT callers retain the unchanged
legacy handlers, with no migration redirect or preference cookie. This runs only
after the existing middleware authentication, delegation and fixture boundaries:
community PATs remain restricted, and the retained discovery probe still needs
its validated identity, expiry, environment and exact GET allowlist. New canonical
routes remain closed to PATs because Me is intentionally browser-session only.

Successful canonical visits save the plain validated SpaceId as `ttv-last-space`
using the shared cookie serializer, so selection works without JavaScript.
Responses affected by this routing use `Cache-Control: no-store` and `Vary:
Cookie`; rollout- and identity-dependent 301s must not stick across flag changes.

## Onboarding (B-O.4)

`onboarding-routing.ts` holds the pure rules; `space-routing.ts` applies them
(onboarding SPEC §3). Intents and requests choose where a person starts and
never what they may open: every candidate space is already in `Me.spaces`,
filtered through any restricted identity's allowlist.

- **`/dashboard/welcome` (`WELCOME_PATH`)** belongs to no space: no tabs, no
  last-space cookie, outside `isNewSpacePath`.
  - Onboarding off (or `spaces` off): `?intent=mentor|institution|member`
    302s to `/dashboard/mentorship`, `/dashboard/discover` or `/dashboard`, so
    the partner-page links never 404. Without a valid hint, and for every
    POST, it is 404.
  - On: `?intent=` naming an access role already held 302s to that space.
    Anything else reaches the page (U-O.1), where the hint only preselects a
    card; the page refuses PATs and agent sessions itself.
  - If the space context fails, a hinted GET still takes its legacy route;
    the step itself fails closed through the error observer.
- **`GET /dashboard` for a NEW account** (`member_onboarding.stage = 'NEW'`)
  302s to the welcome step, keeping the query. Never for: admins, accounts
  holding MENTOR or INSTITUTION, any cohort footprint (an application,
  membership or assignment), PATs, agent sessions (preview personas
  included), QA, demo and fixture identities, deep links and non-GET/HEAD
  requests.
- **The default space** (`selectLandingSpace`), after an explicit URL, which
  never reaches the choice:
  1. an unseen approval (APPROVED, unseen, role still held), mentoring first;
  2. the last-space cookie, except a stale `admin` whenever another space
     exists: Admin lives at `/admin`, outside the cookie's `Path=/dashboard`,
     so nothing there can replace it (#256 review). This holds with onboarding
     off too;
  3. `preferredSpace` of the saved intents, or else the inferred ones;
  4. `SPACE_ORDER`.
  With onboarding off only 2 and 4 apply, and no onboarding table is read.
  If the onboarding read fails, the choice falls back to 2 and 4 and the
  failure is recorded as a warning.
- **An approval is seen** when its holder opens any page of the space it
  unlocked (a successful GET; not HEAD, a legacy redirect, an admin without
  the role, or a delegated or restricted session), via
  `markAccessRequestSeen` by role. The write runs after the response through
  `waitUntil` (awaited only without an execution context), so these pages never
  wait for it. A failed write is recorded as a warning; the approval is then
  preferred once more.

Restricted identities may GET the welcome step (it is in `SPACES_READ_PATHS`)
so partner-page links resolve for them; POSTs and the onboarding APIs stay
closed, because retained personas have no cleanup.

## Bridge to U-1.2

This change does not move or redesign page markup. Canonical routes use Astro's
single-pass `next(Request)` rewrite to the existing page. Methods, form bodies,
query parameters and dynamic route IDs reach the existing handler. Legacy POSTs
continue in place, avoiding a 301 that could discard the body. Existing links
therefore still resolve through the redirect table.

U-1.2 must replace the rendering rewrite in `serveSpacePage` when moving a page
to its canonical path, while preserving legacy redirects, OFF behavior and
the same access guards. Keep the pure alias map for restricted allowlists;
do not turn it into a broad prefix allowlist. New channel, direct-message,
mentor-request, availability and certificate page routes remain 404 until
their owning phase supplies a real page and its guards. Existing public
certificate URLs are unchanged.

U-1.2 also owns browser error-page composition: routing currently returns minimal
403/404 responses. Keep their status and no-store policy when adding styled errors;
do not redirect an unauthorized explicit URL to a different space.

The Admin entry remains `/admin` under the existing admin middleware. It is
an authorized default destination, but its explicit visits cannot read the
`Path=/dashboard` preference cookie; the client shell can save a selected tab
before navigation.

## Restricted staging identities (B-1.5)

The demo, QA and fixture allowlists (`src/lib/staging-*-policy.ts`) open these
Phase 1 surfaces as exact paths, after `legacySpacePath`. Flags, capabilities and
handlers still decide what each caller sees.

- GET/HEAD for every identity: `/api/platform/me`, `/api/attention`,
  `/api/attention/count`, `/dashboard/attention` and `/dashboard/welcome`.
- GET/HEAD Apply form (`/dashboard/cohort/apply`, alias `/dashboard/apply`): demo,
  fixtures, and only the `member-noncohort` QA persona.
- Fixtures also get GET/HEAD `/dashboard`, the cohort home and the spaces entry, and
  POST `/api/attention/read`. That marks only the caller's own rows, and fixture
  cleanup deletes the user, which cascades to them.
- Space homes keep their existing per-persona QA gates.

QA-1 limits: submitting an application stays denied for every identity, because
no QA ledger or cleanup covers it. Search is not allowlisted: its handler refuses
fixture and QA identities because search has no fixture scope (B-1.4), so QA-1
can't exercise search with them; the overlay shows "That search isn't open to
you." On the dashboard home (OFF, or the cohort home for a fixture with cohort
access), the next-step link is filtered for QA but not for fixtures, so it can
point at a page that returns 403. Demo and QA personas can't mark attention read,
because their retained rows have no reset path. This change opens none of
profile and account (`/dashboard/me`, `/dashboard/account`), Ask, sessions,
channels, mentoring requests and availability, admin, PAT, MCP, recordings, chat
or tokens; existing allowances and handler guards are unchanged. Demo
and QA are also past their fixed cutoffs, so only fixture identities are live.

Tests: `npx vitest run src/lib/platform/server/space-*.test.ts src/lib/platform/server/onboarding-routing.test.ts src/middleware.test.ts src/lib/staging-*.test.ts`.
