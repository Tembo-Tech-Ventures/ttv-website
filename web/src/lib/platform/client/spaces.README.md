# Shell client state (S-1.3)

This library has no page, server or middleware consumers in this change. It does
not fetch, navigate, register global listeners or write server state. All authority
comes from the current validated `Me`; disabled `Me.flags.spaces` and signed-out
`null` contexts expose no selectable spaces or drawer actions. These are display
guards; the server must still authorize each request and return 404 when OFF.

## Shared server default

Import `spaces-selection.ts` directly from page frontmatter/server code. It imports
only the existing contracts, with no React or browser globals:

```ts
selectDefaultSpace(spaces: readonly SpaceId[], options?: {
  explicitSpace?: unknown; lastSpace?: unknown;
}): SpaceId | null
readLastSpaceCookie(cookieHeader: string | null | undefined): SpaceId | null
serializeLastSpaceCookie(space: SpaceId, secure: boolean): string
```

Pass **current** `Me.spaces`. An authorized explicit URL wins over an authorized
cookie; otherwise the first authorized `SPACE_ORDER` entry wins. Empty membership
returns null. Candidates are checked with `SpaceId` and membership; cookies do not
grant authority. This helper does not authorize or redirect an explicit forbidden
URL: that decision belongs to server route guards. No path parsing/encoding occurs
here; pass the already parsed space value.

`ttv-last-space` holds a **plain SpaceId string**, without JSON or URL decoding.
`readLastSpaceCookie` takes a complete Cookie header and rejects ambiguous duplicate
names. A server using `Astro.cookies` can instead supply its raw cookie value as
`lastSpace`. Cookie attributes: `Path=/dashboard; SameSite=Lax; Max-Age=31536000`,
plus `Secure` on HTTPS; no `HttpOnly`. This is a client-readable preference.

B-1.1 and B-1.2 own server integration: select and redirect using this helper on
the server, even when JavaScript is absent. They should pass that same context,
explicit space and cookie header to the island for matching SSR/hydration data.

## Controller and React hook

```tsx
import { useState } from "react";
import { createSpacesController } from "@/lib/platform/client/spaces";
import { useSpaces } from "@/lib/platform/client/hooks/spaces";

const [controller] = useState(() => createSpacesController({
  me, explicitSpace, cookieHeader, // serializable server-provided data
}));
const shell = useSpaces(controller);
// Fixture mode: createSpacesController({mock: "joseph", explicitSpace: "discover"})
// On switch, navigate using the UI/server route map only if this returns true:
shell.switchSpace("community");
// After a fresh validated /me response or logout:
controller.setContext(nextMeOrNull, nextExplicitSpace);
```

`createSpacesController(SpacesOptions): SpacesController` creates one instance per
island/SSR request. `useSpaces(controller)` subscribes with `useSyncExternalStore`
and returns `SpacesState` plus `switchSpace`, `dispatchDrawer`, `handleDrawerKey`.
`SpacesState` exposes `me`, `enabled`, `spaces`, `selectedSpace`, `drawer` and
`preferenceStatus` (`idle | saved | unavailable`).

Construction and SSR have no cookie effects. After hydration the hook reads the
browser cookie and persists the authorized selection. A successful switch closes
the drawer and saves the preference. Storage errors or silently refused writes
leave in-memory switching usable and set `unavailable`. Mock mode uses existing
synthetic fixtures and never reads or writes cookies. `browser?: SpacesBrowser`
injects cookie/protocol ports for tests. No network/retry lifecycle is needed:
the server owns `Me`, and callers apply fresh payloads with `setContext`.

`setContext` revalidates the entire DTO and immediately reselects using the fresh
membership, closing the drawer. Null or malformed context clears stale authority;
malformed input returns false. It performs no persistence. `getServerSnapshot`
always retains the original immutable hydration snapshot; `getState` is live.

## Drawer keyboard integration

The mobile drawer contains the current space's sidebar, not a space-selection
menu. `dispatchDrawer({type: "open", itemCount})` requests the first focusable
element. `dispatchDrawer({type: "focus", index, itemCount})` tracks native focus
changes. The UI supplies all currently enabled focusable items, including close
controls, in DOM order. `handleDrawerKey(key, itemCount, shiftKey?)` returns true
for handled Tab/Escape; prevent default only then. Tab/Shift+Tab wrap, including a
single item; no items requests focus on the dialog container. Escape or
`dispatchDrawer({type: "close"})` closes and requests trigger focus. Enter/Space,
arrows and other keys retain native link/button behavior. Clicking a navigation
item should close the drawer before navigation.

`drawer` exposes `open`, `focusIndex` and `focusTarget` (`drawer | trigger | null`).
The UI applies those focus intents and owns actual dialog semantics, focusability,
background inertness, scroll locking and responsive presentation. The pure
`spacesDrawerReducer` is also exported from `spaces-drawer.ts`.

Run from `web/`:

```sh
npx vitest run src/lib/platform/client/spaces*.test.ts src/lib/platform/client/hooks/spaces.test.tsx
```
