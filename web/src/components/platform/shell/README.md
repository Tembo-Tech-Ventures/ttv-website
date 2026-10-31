# Spaces shell (U-1.1)

The frame every space page sits in: the TEMBO mark, the space tabs standing on
the active space's sheet, search, attention and the account menu; inside the
sheet, the space's sidebar and the page. Below 64rem the tabs become a bottom
bar (spaces only, Profile last) and the sidebar a drawer. Dark until the
`spaces` flag is on for the person.

## Using it from a page (U-1.2)

```astro
---
import SpacesLayout from "@/layouts/SpacesLayout.astro";
import SidebarGroup from "@/components/platform/shell/SidebarGroup.astro";
import SidebarHeader from "@/components/platform/shell/SidebarHeader.astro";
import SidebarLink from "@/components/platform/shell/SidebarLink.astro";
import { canRenderSpace } from "@/components/platform/shell/access";
import { getSpaceContext } from "@/lib/platform/server/space-context";

const me = await getSpaceContext(Astro); // a thrown Response means flag off or signed out: return a 404
if (!canRenderSpace(me, "community")) return new Response(null, { status: 404 });
---
<SpacesLayout me={me} space="community" title="What's new">
  <Fragment slot="sidebar">
    <SidebarHeader title="Community" description="Builders, alumni and mentors across every cohort." />
    <SidebarGroup>
      <SidebarLink href="/dashboard/community" label="What's new" icon={PiHouse} current />
    </SidebarGroup>
  </Fragment>
  <h1>What's new</h1> <!-- the screen's one Mattone heading -->
</SpacesLayout>
```

- `SpacesLayout` throws if `canRenderSpace` is false, so a missing guard fails loudly.
- Only `Me` and the parsed `ttv-last-space` value reach the island. Never pass
  the Cookie header, session or auth objects as island props.
- The document does not scroll. `#spaces-main` (the page) and the sidebar
  scroll inside the sheet; a full-height view such as a channel can size
  itself to `#spaces-main`.
- Without a `sidebar` slot there is no drawer and no menu button.
- Without JavaScript the drawer opens through its `#space-sidebar` link, and
  the account menu is a native `details` disclosure (Account and Sign out work;
  Feedback appears once hydrated). On hydration the shell adopts an open
  fragment as drawer state and drops it, so every way of closing works.
- Tabs link to `SPACE_HOME` in `space-routes.ts`, which is B-1.2's canonical
  `SPACE_PATHS` (`@/lib/platform/server/space-routes`, a pure path map).

## Overlay triggers (U-1.3)

The search trigger, Ctrl K / ⌘ K and the attention bell appear only for the
overlays a page mounts: pass `overlays={["search", "attention"]}` and put the
overlay islands in the layout's `overlays` slot. Each overlay subscribes with
`onShellOverlay(name, handler)` from `overlays.ts`; the handler receives
`{overlay, trigger, via}` and owns the dialog, its focus, and returning focus
to `trigger` on close. The bell's and tabs' counts start from `Me.unreadCounts`;
when the page mounts the attention overlay, its store publishes authoritative
counts through `publishAttentionCounts` and the shell follows them. The real
overlays are `components/platform/overlays/PlatformOverlays` (see its README).

## Motion

Switching spaces is a cross-document view transition between two spaces
pages: the tab row (not named, so it cuts to its new state) stays as the anchor while the chosen sheet, opaque, rises
4.5rem into place over the dimmed old one (250ms). With reduced motion the
pages do not opt in, so it is a plain cut. The drawer slides in 220ms and is
static under reduced motion.

## Tests

- `npx vitest run src/components/platform/shell`
- `npx playwright test e2e/platform-shell.spec.ts` against `astro dev`
  (`/dev/platform-shell?persona=<fixture>&space=<space>`, DEV only; 404 on
  deployed builds). It sweeps 320–1440px, runs axe, checks focus order, the
  drawer, the menu, no-JS use, the transition's length, and the cookie boundary.
