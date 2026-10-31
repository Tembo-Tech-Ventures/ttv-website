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
existing allowlist. Explicit authorized URLs win over cookies; forbidden URLs
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

Tests: `npx vitest run src/lib/platform/server/space-*.test.ts src/middleware.test.ts`.
