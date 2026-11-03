# ARCH-1: an incremental path to a persistent, animated app shell

Task 01M6HFTTV4J01R1B182HBC2RA3 · 2026-11-03 · plan and throwaway spikes only. Nothing here is merged, and **no stage starts without Raph's approval.**

Every number is labelled **(measured)** or **(estimated)**. "Local" means `astro build` + `astro preview` with local D1 in the SAM workspace, so there is no network latency. Local numbers show client-side cost, not what a Kenyan visitor waits.

Builds on:
- PERF-1 (`/reports/frontend-navigation-perf-2026-11-03/REPORT.md`, #323–#325);
- PERF-2 (#329: trace and navigation harness; request-scoped capabilities; loaders as plain functions);
- PERF-3 (#330 Community SSR, #327/#328 Worker diet).

None of their files are touched here.

---

## 1. Recommendation

**Build a persistent frame around server-rendered sheets. Let the live surfaces navigate inside themselves over JSON. Do not rewrite the dashboard as a client-routed React app.**

The pieces:

1. **Frame (persists).** Split the chrome out of `SpacesShell` into islands that survive navigation:
   - the tab row and top bar;
   - the phone's bottom bar;
   - the drawer controller;
   - the search and attention overlays;
   - the feedback widget and the route announcer.

   The **sheet** (the space sidebar and the page) stays server-rendered Astro, exactly as today.
2. **Navigation.** Astro's `ClientRouter` swaps the sheet, with `transition:persist` on the frame islands themselves (not a wrapper, or new props are not copied), `fallback="swap"` and router prefetch off. It sits behind our own thin `navigation` module, which owns:
   - focus after a route change;
   - T15's same-sheet skip;
   - the click-time "card-file" beat;
   - 401, 404 and flag handling;
   - the opt-outs.

   With no JavaScript, or with the flag off, it is today's MPA with native cross-document view transitions.
3. **Surfaces (navigate inside themselves).** Channels, threads, the mentor directory and drawer, the attention inbox and Community are already React islands over typed JSON APIs (`apiClient`, `store`, `poller`). They get in-surface navigation:
   - switching channels without a document load;
   - the thread rail as a shared element.

   They also get a per-user query cache shared across islands.
4. **Motion system.** Tokens and a small set of named gestures (§7) on the View Transitions API, same-document and cross-document. CSS and WAAPI only, and every gesture is a cut under reduced motion.

**Why not (B), a client-routed React app for `/dashboard`:**
- It is a rewrite of 57 page files (27 dashboard, 30 admin; measured by file count) and their server-handled forms (50 `method="post"` forms in 23 files, 28 frontmatter POST handlers under `dashboard/` and `admin/`; measured by grep) into React views plus JSON loaders.
- It either gives up the no-JS guarantee the platform standards require, or keeps two implementations of every page.
- Its motion advantages over the recommendation are small. Shared-element transitions work across ClientRouter swaps and across documents. Cached instant revisits are the one real gain, and stage 4 gives that to the surfaces where it matters.
- B stays an evidence-gated option per surface (stage 6), not a destination.

**Why not (A) as #325 wired it:**
- `transition:persist` cannot keep a shell that renders the page as its children.
- Router prefetch doubled requests.

Both are fixable. Locally, the spike shows the fixed version at parity for link navigation. Form posts through the router still failed on the preview, so forms stay document POSTs (§3.4).

**Why the server still comes first.** No client architecture removes the first visit's round trips. At 10–12 sequential D1 waves of 200–300 ms each (PERF-1, estimated from measured RTT × measured waves), every option costs 2–4 s per uncached click from Kenya. A persistent frame lets the gesture start at the click, but the content still arrives when the server answers. Phase 0 (placement next to D1) and PERF-2's wave cuts are therefore stage 0 here. The recommendation's targets assume them.

---

## 2. Options compared

| | (A) Persistent frame + ClientRouter (recommended, with C) | (B) Client-routed React app for /dashboard | (C) Hybrid: in-space client nav, full loads across spaces | (D) Native cross-document VT + speculation rules ("fake SPA", today + prefetch) | (E) Hand-rolled fragment navigator (Turbo-style) |
|---|---|---|---|---|---|
| **Gesture timing** | Starts at the click (spike: tab forward and sheet settling before the server answers), then the sheet rises on swap | At the click, from cache or skeleton | At the click inside a space; across spaces, after first paint | Only once the new document can render. Nothing moves during TTFB | At the click |
| **Shared elements** (card → rail, list → detail) | Yes: same-document VT across swaps, and inside islands | Yes, anywhere | Inside a surface | Yes across documents (Chromium, Safari 18.2+), but no state | Yes |
| **List reorder, optimistic updates** | Inside islands (they exist today: outbox, reactions) | Everywhere | Inside surfaces | Inside islands only | Inside islands |
| **What persists** | Frame island state, overlays, pollers in the frame, JS heap and module cache; drafts already in storage | Everything | Within a surface | Nothing but storage | Frame + heap |
| **Menus** | Close on navigation, by rule; no re-hydration | Same | Same | Re-hydrate every click | Same |
| **Access checks** | Unchanged: every sheet is rendered per request through the middleware | Every view needs a JSON loader with its own checks; client decides nothing, but the surface area doubles | Unchanged for pages; existing JSON checks for surfaces | Unchanged | Unchanged |
| **No-JS** | Unchanged (no router without JS) | Lost, or two implementations | Unchanged | Unchanged | Unchanged |
| **First-load JS** | +4.8 KB gz router (measured) + ~0 for the split | +28 KB gz (TanStack Router) or +32 KB gz (React Router 7) + 10.5 KB gz (TanStack Query), measured minified + gzip, React excluded; plus every page's view code | +10.5 KB gz if TanStack Query (measured) | +0 | +2–4 KB gz (estimated) |
| **Server cost per nav** | One document request (measured: 1 request/click with prefetch off) = MPA; frame-only reads can't be skipped without a custom loader (§4) | 1–3 JSON calls per view, each through the full middleware; revisits free from cache | Channel switch = 1 JSON call instead of a document | MPA; prefetch adds 120–150 D1 queries/click at `immediate` (PERF-1 measured) | One fragment request; can skip the frame's data (1–2 waves before placement, ~ms after) |
| **e2e impact** | Focus and DOM-sync fixes; forms stay document POSTs (they failed under the router on the preview, §3.4) | New suite for every page | Small | None | Like A, plus our own script and history handling |
| **Effort to first value** | 3–4 weeks to stage 3 (estimated) | 8–12 weeks before parity (estimated) | 1–2 weeks for channels (estimated, PERF-1 §3.7) | ½–1 day (PERF-1) | 4–6 weeks (estimated) |
| **Main risk** | Astro router internals (swap, scripts); focus | Rewrite, parity, two codebases | Limited scope | None, but no persistence | We own a router |

The verdict: A + C, with D as the fallback for no JS and unsupported browsers. E is the exit plan if Astro's router internals become a liability, since its frame and sheet contract is the same as A's. B stays per-surface and evidence-gated.

---

## 3. Evidence

### 3.1 Spike A: chrome split + ClientRouter (`spike/arch-1-a-chrome-split`, draft #331, do-not-merge)

What changed:
- `SpacesShell` was split into a `SpacesChrome` island drawn twice: the tab row (`part="row"`) and the bottom bar (`part="bottom"`). Both carry `transition:persist`.
- The sheet, sidebar, drawer markup and `<main>` became server HTML in `SpacesLayout`.
- `ClientRouter` runs with `fallback="none"` and `prefetch: false`.
- `FeedbackWidget` is persisted.
- T15's same-sheet skip was ported to `astro:before-swap`.
- `?mpa` or the `ttv-arch=mpa` cookie turns the router off in the same build.

**State survival (measured, local).** Across 18 navigations per run, mixing tabs and sidebar links, the chrome's DOM node survived 18 of 18 under the router and 0 of 18 in MPA. Each click made exactly 1 document request (prefetch off). No React hydration errors (#418/#423) appeared. The only console error was the existing "Transition was skipped", which MPA logs too.

**Click → new h1 visible (measured, local, same build, student persona, 3 reps × 6 steps, Chromium):**

| profile | MPA median / p75 | router median / p75 |
|---|---|---|
| CPU ×1 | 376 / 533 ms | 433 / 513 ms |
| CPU ×4 | 633 / 661 ms | 469 / 661 ms |

So once the chrome is split and prefetch is off, the router is at parity, unlike #325's 1.4–1.7× slowdown. Local runs carry no network latency, so this measures client cost only. A preview comparison under PERF-2's harness (#329) is stage 2's exit gate.

**The #325 failures, re-tested (measured, local, against main's 75 passed / 0 failed on the same five specs):**

| #325 failure | after the split |
|---|---|
| `cohort-management` ×2 (router swaps the POST result) | **pass** locally; **fail** on the preview (§3.4) |
| `feedback-widget` ×2 (save fails) | **pass** locally with the widget persisted; **fail** on the preview (§3.4) |
| `platform-flags` "asks before Everyone" ×2 | **fail**: the confirm uses `autofocus`, which browsers apply only on a full document load. Fix: the focus utility honours `[autofocus]` (rule A1) |
| `platform-personas` F-3 skip link ×1–2 | **fail**: after a tab click, focus stays on the persisted tab, so the first Tab doesn't reach "Skip to content". Fix: focus a route-start target before the skip link (A1). A naive version raced the router's `page-load` event |
| (new, spike-made) drawer `role=dialog` ×6 on phones | **fail**: the persisted island must re-apply its state to swapped server DOM. This is the main structural cost of A (risk R3) |
| (new, spike-made) landing hint ×2 | not ported in the spike |
| sign-out | `data-astro-reload` needed, as PERF-1 found (rule S5) |

**Preview full suite on #331:** see §3.4.

### 3.2 Motion spike (`/dev/arch-motion`, same branch)

The signature interaction, mocked in the leading option with real `SpaceFile`, sidebar and fixtures, and the server held 600 ms (`?delay=`):
- **Space-tab sheet change.** On `astro:before-preparation`, the chosen tab comes forward at once and the sheet you are leaving settles 6 px and dims (180 ms). When the answer arrives, the existing T15 rise plays (250 ms).
- **Thread from a card.** The card becomes the head of the thread rail (a shared element, same-document VT, 280 ms), and the rail slides in as a second sheet (300 ms, +40 ms). Escape or Back reverses it into the card, and focus returns to the card. A reply appears at once as "Sending…" and settles on confirmation.

Frames (CDP screencast, measured):
- the tab was forward at 86–313 ms while the old sheet was still on screen;
- the new sheet rose from 999 ms (600 ms server + local render);
- the rail was settled by 525 ms after the card click.

With reduced motion every step is a cut, and the rail opens in 36–51 ms (measured). Recordings, frames, summaries and the recorder are in `arch1-motion-spike.tgz` beside this plan: desktop 1440×900, phone 390×844, desktop with reduced motion.

Critique from the frames, to fix before production:
- While the request is pending, the chosen tab stands forward but is not yet fused to its sheet. Production should use a "lifting" tab state (raised, not active) until the swap, so the card-file metaphor holds.
- The shared-element morph stretches the card's text mid-flight. Morph the card's frame and cross-fade its contents (`view-transition-class`), or keep the text box size-locked.

### 3.3 Bundle cost of option B's libraries (measured)

Measured with esbuild `--minify` on named imports, with React excluded:

| library | minified | gzip |
|---|---|---|
| React Router 7.18 | 95.4 KB | 32.2 KB |
| TanStack Router 1.170 | 78.1 KB | 28.1 KB |
| TanStack Query 5.105 | 35.4 KB | 10.5 KB |
| Astro ClientRouter, from the spike build | 13.9 KB | 4.8 KB |

For scale, today's spaces page ships ~480 KB decoded and 176 KB over the wire (PERF-1, measured).

### 3.4 Preview #331 (CI)

Preview run 41713408601 at `ffb549d` (measured, CI on the US runner, full suite, both projects): **312 passed, 15 failed, 2 flaky, 833 skipped.** For comparison, #325 had 314 passed and 10 failed.

Spike-made failures (not router problems):
- drawer `role=dialog` on phones ×5;
- landing hint ×2.

Failures that are router problems:
- `platform-flags` "asks before Everyone" ×2 (`autofocus`);
- F-3 skip link ×1 (focus restored to the persisted tab).

Forms still fail on the preview, unlike the local run:
- `cohort-management` ×2: a stale result list ("View certificate" matched 8 links) and a status read back as COMPLETED instead of APPROVED;
- `feedback-widget` ×4: "receipt was not validated";
- `admin-curricula` ×1 (mobile).

Conclusion: the split fixes persistence and the request count, but **not** form posts through the router. The plan therefore keeps form POSTs as document loads (§5 stage 2, rule F1).

---

## 4. Architecture of the recommendation

```
SpacesLayout (server, every request: middleware → getSpaceContext → page loader)
├── <head> SheetTransition (cross-document fallback), ClientRouter (flag app_shell), route-start target
├── .spaces-shell (server markup)
│   ├── Skip to content
│   ├── .space-file
│   │   ├── [persist] FrameRow island: brand, tabs, phone top bar, tools (search, bell, account), drawer controller
│   │   └── .platform-sheet (server HTML, swapped)
│   │       ├── aside#space-sidebar (server HTML; same within a space, `current` changes)
│   │       └── main#spaces-main: the page (Astro + its islands: ChannelView, CommunityApp, …)
│   └── [persist] FrameBottom island
├── [persist] overlays: PlatformOverlays (search, attention), FeedbackWidget
└── navigation module (bundled once): focus, announcer, pending beat, T15 skip, 401/404, opt-outs
```

- **Server truth on every navigation.** The frame gets `Me` as props from each new page's server render. Astro copies a persisted island's new props in `swapBodyElement`. A removed role or a flag turned off shows on the next click, as it does today.
- **Frame-owned DOM contract.** The frame may set only these, on the swapped sheet, after each swap:
  - `data-drawer`, `data-hydrated`, `data-nav-pending` on `.spaces-shell`;
  - `role` and `aria-modal` on `#space-sidebar`.

  One `syncFrameToSheet()` runs on `astro:after-swap` and is unit-tested. This keeps the R3 failure class small.
- **Swap guard (required).** Astro's router never checks the response status, and after a form POST it swaps the response in even when it has no `ClientRouter` (verified in `astro/dist/transitions/router.js`). So a 404 or 500 page, or a POST redirected to `/auth/login`, would land inside the sheet. The navigation module's `astro:before-swap` handler checks that `event.newDocument` is a shell page for the same identity (a `ttv-shell` meta carrying a hash of the user id). Otherwise it replaces the swap with `location.assign(event.to)`.
- **Server optimisation: not with Astro's router.** Making the page skip frame-only reads (attention count, Tembo usage, an unchanged sidebar) needs a request header such as `X-TTV-Frame: kept`. The default loader is a closed-over fetch. A custom `event.loader` would have to re-implement the fetch, redirect, content-type, parse, meta and stylesheet steps, plus Astro's internal headers. Before placement this would save 1–2 waves (about 0.2–0.6 s from Kenya, estimated); after placement, milliseconds. It is an advantage of option E only, and a reason to revisit E if stage 0 stalls.

---

## 5. Stages

Each stage is shippable alone, behind a flag where it changes behaviour. Raph approves each stage before it starts. A new platform flag, `app_shell` (OFF/STAFF/ALL, migration-seeded OFF, effective only while `spaces` is), gates the router. Stage 1 changes no behaviour and needs no flag.

### Stage 0: the server (owned by PERF-2/PERF-3; ARCH only gates on it)
- **Entry:** now.
- **Work:**
  - placement next to D1 (PERF-1 phase 0, an owner check of production D1's region);
  - request-scoped capabilities, parallel `getMe`, loaders started together (PERF-2);
  - Community SSR (#330);
  - the Worker diet (#327/#328).
- **Exit (measured with #329's harness on a preview, plus FRA probes):**
  - ≤ 5 D1 waves before first byte on spaces pages;
  - TTFB p75 from FRA ≤ 500 ms warm.

### Stage 1: groundwork, safe now (no flag, no behaviour change)

| item | what | owner lane | exit |
|---|---|---|---|
| 1a | **Split the chrome out of SpacesShell** under MPA: FrameRow and FrameBottom islands, server-rendered sheet, `syncFrameToSheet()`, landing hint and person footer ported. No router yet | UI | Every existing e2e and axe spec green; pixel diff of shell screenshots at 390/1440 ≤ 0.1%; island JS ≤ today's SpacesShell |
| 1b | **Route-change focus utility** `focusAfterNavigation(root)`: `[autofocus]` / `[data-autofocus]` in the new sheet → else a route-start target before the skip link. Plus `announceRoute(title)` over the existing `createAnnouncer` | UI + client state | Unit tests; a harness e2e that drives it with synthetic swaps; no-op under MPA |
| 1c | **Motion tokens** in `global.css` `@theme`: durations (`--motion-press` 180 ms, `--motion-sheet` 250 ms, `--motion-rail` 280–300 ms), easings (`--ease-file-rise`, `--ease-file-settle`), distances. Migrate SheetTransition, channels' rail and the drawer to them | UI | Values unchanged (frame-diffed recordings); a lint rule that motion durations in `src/components/platform/**` use tokens |
| 1d | **401 contract.** Platform JSON returns **401 `unauthenticated`** when there is no session. Today `requireFlag` answers 404 `flag_off` first (`flags.ts:38`, `82–85`; `me.ts:22`), so clients can't tell "signed out" from "feature off". Flag-off stays 404 | backend | Contract tests for every platform route: signed out → 401, flag off → 404, no access → 404/403 as today |
| 1e | **Typed client data layer**: `queryKeys` per route in contracts, `createQueryCache(userId)` (decision in §6), invalidation map per mutation (§6.3). Consumed by no page yet | client state | Unit tests: keys include `userId`; reset on user change; invalidation map covers every mutating route in `ROUTES` |
| 1f | **Shared loader/API contract**: PERF-2's plain loaders return the same Zod DTOs the JSON routes return, so a page and its API share one function (as PERF-3 does for Community) | backend, with PERF-2 | One page (channel) and its API share a loader, with a test |
| 1g | **Script audit for the router**: 18 files with bundled `<script>` and 16 with `autofocus` (measured, grep). Convert per-page setup to islands or `astro:page-load`; list `autofocus` users for 1b | UI | Inventory checked in; each script is idempotent per page |

Effort (estimated): 1a 4–6 days, 1b 1–2, 1c 1–2, 1d 1–2, 1e 2–3, 1f 2–3 (with PERF-2), 1g 1–2. About 2.5–3.5 weeks across lanes, parallelisable.

### Stage 2: persistent frame behind `app_shell` (STAFF first)
- **Entry:** stage 0 exit; 1a, 1b, 1d and 1g merged.
- **Work:**
  - `ClientRouter` in SpacesLayout only when `app_shell` is on for the caller, with prefetch off;
  - frame islands `transition:persist`;
  - the T15 skip on `astro:before-swap`;
  - `data-astro-reload` on sign-out, demo switch and any link leaving the shell;
  - **F1: every `<form method="post">` stays a document POST by default** (`data-astro-reload` added by the layout). The router swaps link navigations only. Post-backs keep T15's cross-document skip. A form opts in to the router only after its flow passes e2e with the router on. Spike evidence: with the router, `cohort-management` and `feedback-widget` failed on the preview (§3.4);
  - the 401/404/redirect handling (S3, S4).
- **Exit:**
  - the full e2e suite green with `app_shell` on and off (the e2e matrix runs both);
  - axe clean;
  - click→visible p75 with the router ≤ MPA in the same deploy (#329 harness, fast and throttled);
  - zero `pageerror`s and hydration warnings across the journeys;
  - a heap test (200 navigations) growing less than 10 MB;
  - one request per navigation.

  Then STAFF for one week with no regressions in `/admin/feedback` or the error buffer, then ALL with Raph's yes.
- **Effort:** 6–9 days (estimated).

### Stage 3: the card-file gesture at the click
- **Entry:** stage 2 at STAFF.
- **Work:** the spike's pending beat, productionised:
  - a lifting tab state rather than "active";
  - the settle on the old sheet;
  - a quiet delayed dim within a space;
  - interruption (a second click retargets);
  - reduced motion as a cut;
  - back and forward restore scroll with no animation.
- **Exit:**
  - INP p75 ≤ 200 ms on tab clicks (throttled harness);
  - visual feedback ≤ 100 ms after the click (screencast frame, measured);
  - frame-by-frame review recorded at 390 and 1440;
  - the ttv-ui-motion two-judgment review passes.
- **Effort:** 4–6 days (estimated).

### Stage 4: surfaces navigate inside themselves (flags `channels`, `mentor_requests`)
- **Entry:** stage 2 at STAFF; 1e and 1f merged.
- **Work:**
  - **Channel switching** inside ChannelView: `pushState`, a messages fetch, polling handed over, the sidebar's `current` moved, focus to the channel heading, announcement. No document load. The no-JS link still does a full load.
  - **Thread rail** as a shared element from the message card.
  - **Mentor drawer** opens from the directory card.
  - **Attention inbox** and **search** keep their results across navigation (they live in the frame).
  - The query cache is shared by the frame and surfaces, so revisiting a channel paints from cache and revalidates.
- **Exit:**
  - channel switch click→visible p75 ≤ 300 ms after stage 0 (preview, fast, measured with #329);
  - D1 queries per switch ≤ 1 JSON call's worth (≤ 6 queries);
  - the e2e channel specs green, plus new cross-tab and stale-cache tests (§6).
- **Effort:** 6–10 days (estimated).

### Stage 5: the Admin space under the frame, with JSON for its hottest actions
- **Entry:** stage 2 at ALL.
- **Work:**
  - admin pages already render in the Admin space (T14);
  - turn on the router there;
  - add the PERF-1 §3.7 status-change JSON route with an island button, keeping the form as the no-JS path;
  - make the "Everyone" confirm work under the focus utility.
- **Exit:**
  - admin e2e green both ways;
  - status change ≤ 3 D1 round trips (measured);
  - no change to the admin guards (`enforceAdminGuards` runs for every swap).
- **Effort:** 5–8 days (estimated).

### Stage 6: evidence-gated, and maybe never
- PERF-4's `nav_prefetch` (Speculation Rules `moderate` on tabs and sidebars, with the `Sec-Purpose` guard), once TTFB < 400 ms.
- Client-rendered views (option B) for a surface only where the stage 4 data shows cached revisits matter more than server HTML, one surface at a time, behind its own flag, keeping the Astro page as the no-JS path.

---

## 6. State, auth and access correctness rules

Each rule is a testable statement. "Unit" means vitest; "e2e" means Playwright with local personas, run with `app_shell` both on and off.

### 6.1 State

- **S1 (e2e).** After a soft navigation the frame's tabs, counts and person footer equal the new page's server `Me`. Test: an admin removes a persona's MENTOR role in another context; the persona's next tab click hides Mentoring, and `/dashboard/mentoring` answers 403/404.
- **S2 (unit + e2e).** `Me` is never read from the client cache. It arrives only as page props or from `/api/platform/me`.
- **S3 (e2e).** Menus (drawer, account menu, mention list) are closed after every navigation, and focus follows A1.
- **S4 (e2e).** Drafts survive navigation, reload and a thread close (`ttv-channel-drafts:{userId}:{channelId}`, session storage). They are cleared on sign-out.
- **S5 (e2e).** Scroll position:
  - the sheet scrolls to the top on a forward navigation;
  - back and forward restore it (router history state);
  - a channel restores its own anchor (`scrollAnchor`);
  - the sidebar keeps its scroll within a space.
- **S6 (e2e, request count).** There is at most one poller per resource per tab. Leaving a channel stops its poll within one interval. The frame's attention poll survives navigation.
- **S7 (unit).** Cache staleness:
  - `staleTime` 0 for anything access-bearing (Me, channel list, a channel's first page);
  - ≤ 30 s for directory lists;
  - `gcTime` ≤ 5 min.

  A cached entry painted on revisit always revalidates. If the revalidation returns 403/404, the entry is evicted and the not-found state shows.
- **S8 (unit).** Mutations invalidate by a declared map. Examples:
  - post or edit a message → that channel's messages and the channel list (unread);
  - react → the message;
  - read marker → the channel list and attention counts;
  - mentor request actions → requests (both sides) and mentor capacity;
  - access decisions → the attention list.

  Optimistic entries roll back on failure and keep the text (the outbox does this today).
- **S9 (e2e, two pages in one context).** Multi-tab:
  - a `BroadcastChannel("ttv-session")` carries `signed-out`, `user-changed` and `invalidate(keys)`;
  - a sign-out in tab A resets tab B's caches and shows "Your session ended" on its next interaction;
  - unread counts converge within one poll interval, because the server is authoritative.

### 6.2 Auth and access

- **A-1 (contract tests).** Every JSON route keeps its server-side check. The client never decides access: a hidden button is a convenience, never a guard. Each route's test proves that a forged request from a caller without access gets 403/404.
- **A-2 (e2e).** Session expiry or revocation mid-session:
  - **Soft navigation.** The middleware redirects to `/auth/login?next=…`. On a GET, Astro does a full load, because the login page has no `ClientRouter`. On a form POST, Astro would swap the login page in, so the swap guard (§4) turns it into `location.assign`. A login page is never swapped into the sheet.
  - **JSON.** 401 (after 1d) → the frame stops pollers, clears caches and shows "Your session ended. Sign in again" linking to `/auth/login?next=<current>`. A 401 never shows as "not found".
- **A-3 (e2e).** A role removed mid-session: the next navigation's server `Me` drops the space (S1). Its open JSON calls start answering 403/404, and the surfaces show "no longer available" without retrying (terminal codes in `apiClient`).
- **A-4 (e2e).** A flag turned off mid-session:
  - the next page navigation's 404 is caught by the swap guard (§4) and becomes a full load of the real 404 page;
  - JSON answers 404 `flag_off` → the surface stops polling;
  - with `app_shell` turned off, the next response has no `ClientRouter`, so Astro does a full load (router behaviour, to be asserted).
- **A-5 (unit + e2e).** PATs: unchanged. Bearer callers never reach pages, `enforceTokenDelegation` still limits tokens to their prefixes, and the client app sends cookies only. A new read endpoint for the app is browser-only (refuses PAT, like `getMe`) unless it declares token scopes.
- **A-6 (e2e).** Demo, QA and fixture identities: router navigations pass through the same middleware boundaries (`enforceDemoBoundary`, `enforceStagingFixtureBoundary`). A demo persona switch is a full load, so no frame survives an identity change.
- **A-7 (contract tests).** CSRF:
  - every non-GET JSON endpoint requires a matching `Origin` (`hasMatchingRequestOrigin`) and a JSON body via `readBoundedJson`;
  - GETs have no side effects;
  - a router GET carries no new authority;
  - router form POSTs are the same requests as without the router (same Origin, same handlers).
- **A-8 (e2e).** No cross-user bleed on a shared device:
  - sign-out is a full document load (`data-astro-reload`), which drops the JS heap and caches;
  - per-user session/local storage keys are cleared, as `AccountMenu` already does;
  - the query cache is keyed by `userId` and refuses to serve another user's keys;
  - the test signs in as A, opens channels, signs out, signs in as B on the same context, and asserts that none of A's channel names, drafts, search recents or counts appear.
- **A-9 (e2e).** Prefetch, if stage 6 ever happens, never writes: no `ttv-last-space`, no approval acknowledgement when `Sec-Purpose: prefetch` (#324's guard).

### 6.3 Data-layer decision: query cache

- **Keep the existing hand-rolled pieces:** `apiClient` (typed, Zod-validated, retries, terminal codes), `poller` and per-island `store`. They are tested and fit the transport.
- **Add TanStack Query (10.5 KB gz, measured) as the cache only, in stage 4.** Its `queryFn` is `api.call(route)`. It brings dedupe, `staleTime`/`gcTime`, invalidation by key, optimistic mutations with rollback, and focus revalidation that we would otherwise write and test ourselves.
- **Use one `QueryClient` per signed-in user**, created by the frame, and reset on a user change or sign-out (A-8).

Before stage 4, a hand-rolled cache is not needed: the router keeps the heap, and stores already live per island. If the client-state lane prefers to extend `store.ts` instead, rules S7–S9 and A-8 are the acceptance tests either way.

- **No React router.** The document router is ClientRouter, and surfaces sync their own URL as ChannelView does (`?thread=`). If stage 6's B is ever chosen, TanStack Router (28.1 KB gz, measured) is preferred for typed search params.

---

## 7. Accessibility

- **A1 (focus after a soft navigation).**
  - If the new sheet has `[autofocus]` or `[data-autofocus]`, that element gets focus. This covers the "Everyone" confirm and error summaries.
  - Otherwise, a `tabindex=-1` route-start target before "Skip to content" gets focus, so the next Tab reaches the skip link, as after a full load (the F-3 contract).
  - Astro already put focus back on the persisted tab that was clicked (`saveFocus`). That counts as "not placed by the page", so the rule above still applies.
  - The new title is announced once. Astro adds its own `aria-live="assertive"` announcer after every swap, with no option to turn it off. The navigation module removes `.astro-route-announcer` and announces politely through the existing `createAnnouncer` queue, so route announcements never interrupt a message announcement (A7).
- **A2.** Same-space post-backs behave as a full load does today: the error summary takes focus, nothing moves (T15).
- **A3.** Focus-managed flows (the drawer, the mention list, the thread rail, the moderation dialogs, the "Everyone" confirm) keep their own focus. The navigation module never moves focus when the page or island already placed it.
- **A4.** Reduced motion: no view-transition animation (Astro's `viewtransitions.css` and our own `prefers-reduced-motion` guards), no pending beat, and immediate state changes. The spike verified this (rail open in 36–51 ms, measured).
- **A5. No JavaScript, or browsers without view transitions.**
  - Without JavaScript nothing changes: every page is server-rendered, and links and forms work as today.
  - In browsers without view transitions there is no motion. With `fallback="swap"` the frame still persists through a plain swap. The spike used `fallback="none"`, which in those browsers means full loads and no persistence.
  - What we give up: nothing that exists today. Persistence and click-time motion are enhancements.
- **A6.** Opening a thread moves focus to the rail heading. Closing it (Escape, the close button or Back) returns focus to the card that opened it. On phones the list is hidden while the rail is open and is restored before focus returns. The spike showed this is easy to get wrong.
- **A7.** Live regions: new channel messages keep their own `aria-live`, and route announcements never interrupt a message announcement (one announcer queue).

---

## 8. Performance budget and measurement per stage

Measured with #329's harness on the PR's own preview, same deploy, router on and off by flag or cookie, 3 reps, fast and throttled profiles, plus FRA probes. Targets are estimates until stage 0 lands.

| stage | click→visible p75 (preview, fast / throttled) | INP p75 | first-load JS (gz) vs 176 KB today | D1 per navigation | gates |
|---|---|---|---|---|---|
| 0 | ≤ 500 / ≤ 900 ms (spaces pages) | n/a | −0 to −10 KB (PERF-3 diet) | ≤ 5 waves, ≤ 18 queries | PERF-2/3's own |
| 1 | no regression (±5%) | no regression | +≤ 2 KB | unchanged | full e2e + axe green; screenshot diff ≤ 0.1% |
| 2 | router ≤ MPA in the same deploy | ≤ 200 ms | +≤ 6 KB (router 4.8 measured) | unchanged; exactly 1 request per navigation | full e2e green with `app_shell` on and off; zero pageerrors; heap +< 10 MB over 200 navigations |
| 3 | same as 2; feedback ≤ 100 ms after the click (frame-measured) | ≤ 200 ms on tabs | +≤ 2 KB | unchanged | motion review; reduced-motion e2e |
| 4 | channel switch ≤ 300 ms; cached revisit ≤ 100 ms to paint | ≤ 200 ms | +≤ 12 KB (Query 10.5 measured) | channel switch ≤ 6 queries, one JSON call | cross-tab and stale-cache tests; channel specs |
| 5 | admin step ≤ MPA; status change ≤ 3 round trips | ≤ 200 ms | +0 | status change ≤ 3 round trips | admin specs both ways |

**Why phase 0 placement still matters for every row** (estimated from PERF-1's measured RTT and waves): from Nairobi, before placement each wave is 200–300 ms. A router or SPA saves the browser's 25–100 ms of re-hydration per click (PERF-1, measured) but none of the 2–4 s of waves. After placement a click costs about one visitor→Worker RTT (250–300 ms) plus single-digit-ms waves. Only then do the client-side wins (click-time feedback, cached revisits, no re-hydration) dominate what people feel.

---

## 9. Testing and migration

- **Flag matrix.** CI runs the platform e2e specs with `app_shell` off (today) and on (via a local override, like `PLATFORM_FLAGS_OVERRIDE`). A stage cannot ship while either column is red.
- **Pages move one at a time.**
  - Within `SpacesLayout`, a page can opt out with `navigation="document"`, which puts `data-astro-reload` on links to it, until its scripts and focus are audited (1g).
  - Admin pages join in stage 5.
  - There is no big-bang switch: the flag decides who gets the router, and the page opt-out decides which pages it may swap.
- **New tests:**
  - S1–S9 and A-1–A-9 above;
  - a long-session heap test;
  - "router on" variants of platform-shell, platform-personas F-3, platform-flags and feedback-widget;
  - recorded-frame checks for stage 3 (as `platform-channel`'s motion test does now).
- **e2e effect (estimated):**
  - stage 1 changes selectors where tests reach into the shell's React structure (drawer, landing hint);
  - stage 2 adds the on/off matrix (about +40% e2e time for platform specs, or run "on" only on the PR preview).

---

## 10. Interaction and animation inventory

| # | interaction | where | technique | stage |
|---|---|---|---|---|
| 1 | Space tab → sheet rises over the old one (exists, cross-document) | frame | VT `spaces-sheet`, now same-document under the router | 2 |
| 2 | Click-time beat: tab lifts, old sheet settles | frame | CSS on `data-nav-pending`, tokens | 3 |
| 3 | Same-space navigation: no movement; delayed quiet dim if slow | sheet | CSS, 150 ms delay | 3 |
| 4 | Card → thread rail (shared element), rail as a second sheet | ChannelView | same-document VT, `view-transition-class` for content | 4 |
| 5 | Channel switch: header slides along the sidebar's current marker; list cross-fades | ChannelView + sidebar | VT names on `current` marker and header | 4 |
| 6 | New message rises; Jump to latest | ChannelView | exists (`channels.css`), move to tokens | 1c |
| 7 | Optimistic send → "Sending…" → settled, failed → outbox | composer | exists; unify timing tokens | 1c |
| 8 | Reactions toggle with count tick | MessageItem | WAAPI on count | 4 |
| 9 | Mentor card → request drawer | mentors | VT shared element (card → drawer head) | 4 |
| 10 | Drawer slide (phone sidebar) | frame | exists (220 ms), tokens | 1c |
| 11 | Attention panel open, item read, list reorder | overlays | FLIP on reorder; VT for the panel | 4 |
| 12 | Search overlay results grow under the field | overlays | CSS height + stagger ≤ 3 items | 4 |
| 13 | Profile Overview cards expand to their editor | Profile | VT shared element (card → editor heading) across a swap | 3–4 |
| 14 | Admin status change: badge morph, row moves to its new group | admin lists | VT + FLIP | 5 |
| 15 | Onboarding steps share the card-file sheet (exists) | onboarding | unchanged (cross-document, outside the frame) | — |
| 16 | Reduced motion: every item above is a cut | all | media guard + router fallback | every stage |

---

## 11. Risks and mitigations

| # | risk | mitigation |
|---|---|---|
| R1 | Astro router internals (`swapBodyElement`, persisted-props copy, script de-duplication) change in an upgrade | Wrap them in the `navigation` module; e2e covers the contract; pin the Astro minor for router changes; E (own fragment navigator) is the exit, with the same frame/sheet contract |
| R2 | Per-page bundled scripts (18 files) run once; `autofocus` (16 files) is ignored on swap | 1g audit; A1 focus utility; page opt-out until audited |
| R3 | Persisted islands must re-apply state to swapped server DOM (the spike's drawer `role` failure) | One `syncFrameToSheet()` with a fixed attribute list; unit tests; no other frame→sheet writes |
| R4 | Module-singleton stores outlive a page and break hydration (#325's #418/#423) | Islands hydrate from props first (`getServerSnapshot` = props), then subscribe; singletons only in the frame; e2e asserts zero hydration warnings |
| R5 | Stale data after mutations or across tabs | S7–S9 rules; server authoritative; `staleTime` 0 for access-bearing data |
| R6 | Cross-user bleed on a shared device | A-8: full reload on sign-out, cache keyed per user, storage cleared, BroadcastChannel |
| R7 | A gesture that hides slowness: an animation that runs while the server is slow feels broken | Beat ≤ 180 ms then rest; no looping spinners; within-space dim only after 150 ms; stage 0 first |
| R8 | Memory and listener leaks in long sessions (pollers, VT listeners) | Heap test over 200 navigations; pollers owned by surfaces stop on `astro:before-swap` |
| R9 | D1 load from prefetch | Prefetch off until stage 6 with PERF-4's guard |
| R10 | Browsers without same-document view transitions | `fallback="swap"`: an instant swap, still persistent (the spike's `fallback="none"` would give them full loads) |
| R12 | Astro's router swaps error pages and POST redirects to login (it checks neither status nor the router marker on POST) | The swap guard in §4, with e2e for a 404, a 500, and a POST after the session is revoked |
| R11 | Scope creep into B | Stage 6 needs per-surface evidence and Raph's approval |

---

## 12. Effort summary (estimated, agent-days including review and tests)

| stage | effort | can start |
|---|---|---|
| 0 | PERF-2/3 (not counted here) | in flight |
| 1 | 12–20 across UI, backend and client-state lanes | now, with Raph's yes |
| 2 | 6–9 | after stage 0 exit |
| 3 | 4–6 | after 2 at STAFF |
| 4 | 6–10 | after 2 at STAFF, 1e/1f |
| 5 | 5–8 | after 2 at ALL |
| 6 | per surface | evidence-gated |
| B instead (for comparison) | 40–60 before parity | — |

---

## 13. Artefacts

- Branch `spike/arch-1-a-chrome-split`, draft PR #331 (`do-not-merge`, no review):
  - the chrome split;
  - the router with the T15 skip and the focus experiment;
  - `/dev/arch-motion` (DEV only);
  - `e2e/arch-spike.spec.ts` (the local router-vs-MPA measurement).
- `arch1-motion-spike.tgz`, beside this plan: three recordings, screencast frames with ms offsets, run summaries and the recorder script.
- Bundle sizes: esbuild on react-router 7.18.5, @tanstack/react-router 1.170.46 and @tanstack/react-query 5.105.3 (§3.3).
- Local e2e logs: main 75 passed / 0 failed; the spike's results are in §3.1.
- An independent Claude fact-check of the router claims against Astro 7.3.2's source, folded into §4, §6.2, §7 and R12.
