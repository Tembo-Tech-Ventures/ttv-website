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
prefixes return 404. Database failures propagate to the existing middleware
error observer; they never authorize a page or generate a migration redirect.

When ON, recognized legacy GET/HEAD URLs return 301 with their query string
preserved. `/dashboard` uses a non-cacheable 302 to the authorized last-space
cookie or first ordered space, filtered through any restricted identity's
existing allowlist. Explicit authorized URLs win over cookies; forbidden URLs
return 403 rather than falling back. Applying at `/dashboard/cohort/apply`
remains possible before cohort membership, without granting other cohort pages.

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

The Admin entry remains `/admin` under the existing admin middleware. It is
an authorized default destination, but its explicit visits cannot read the
`Path=/dashboard` preference cookie; the client shell can save a selected tab
before navigation.

Tests: `npx vitest run src/lib/platform/server/space-*.test.ts src/middleware.test.ts`.
