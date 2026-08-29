# Full-page chat layout — research and prototypes

Status: shipped. The chosen direction is live at `/dashboard/ask`; `/dev/chat-ui`
renders the same components against fixed data.

The three prototypes this decision came from lived at `/dev/chat-proto/{a,b,c}`
and were removed once the direction was settled — see commit `67571b9` and the
screenshots in the SAM library under `/design/chat-full-page/`. File and line
references to the old implementation below are as of that commit.

## The problem

`/dashboard/ask` renders `ChatInterface` inside `DashboardLayout`, which puts four
independently-scrolling or space-consuming surfaces on one phone screen:

| Surface | Where | What it costs on a phone |
|---|---|---|
| Document | `body` (`min-h-screen`) | The whole page scrolls, so the composer is off-screen on first paint |
| Dashboard header | `DashboardShell.tsx:47` | ~52px, scrolls away, and duplicates the page title |
| Conversation strip | `ChatInterface.tsx:230` (`max-h-80 overflow-y-auto`) | 320px of the first screen, above the messages |
| Message list | `ChatInterface.tsx:294` (`flex-1 overflow-y-auto`) | Only actually scrolls once content exceeds `min-h-[64vh]` |

Nothing in the chain sets a definite height, so the inner `overflow-y-auto` and
the document scroll compete: a drag near the top of the message list chains into
the page, and on Android that reaches pull-to-refresh. The composer is at the
bottom of a `min-h-[64vh]` section rather than pinned, so on a phone the first
thing a user sees is a list of old conversations and no way to type.

`before-current` in the evidence screenshots shows this: on a Pixel 7 the input
is not on screen at all.

## What the research says

Sources are listed at the end. The findings that actually drove the design:

1. **One scroll surface.** Nested scrollers are ambiguous on touch (no scrollbar
   to aim at) and chain into browser gestures. `overscroll-behavior: contain` on
   the transcript, `none` on `html`.
2. **`min-height: 0` is load-bearing.** A flex item defaults to
   `min-height: auto`, so it refuses to shrink below its content and the
   `overflow-y: auto` never engages — it just pushes the composer out of view.
   Every flex ancestor between the page root and the scroller needs `min-h-0`.
3. **`vh` is `lvh`.** Plain `100vh` is sized as if the browser chrome were
   retracted, which is exactly the "composer is under the URL bar" bug. Declare
   `100svh` then `100dvh`. Because the document itself never scrolls here, `dvh`
   resolves once and does not cause the scroll-time relayout MDN warns about.
4. **`dvh` does not solve the keyboard.** Under the default
   `interactive-widget=resizes-visual`, viewport units do not shrink when the
   on-screen keyboard opens. `interactive-widget=resizes-content` fixes Chrome
   Android and Firefox; WebKit has not implemented it (bugs.webkit.org #259770 is
   still open), so iOS needs a `visualViewport` measurement fallback. All three
   layers are in `ChatLayout.astro`.
5. **Safe-area insets are not keyboard insets.** `env(safe-area-inset-bottom)`
   describes the home indicator only, requires `viewport-fit=cover` to be
   non-zero, and is documented to return `0` in cases you care about — so use
   `max(0.75rem, env(...))`, never bare `env()`.
6. **Don't yank the reader to the end.** NN/g found that auto-scrolling to the
   bottom of a streaming answer means users never see its beginning. When an
   answer arrives, the question that prompted it is pinned to the *top* of the
   viewport. Note the pin has to happen then, not at submit: at submit the
   question is the last node, so the scroller is already clamped at the bottom
   and `scrollIntoView` does nothing. Auto-follow applies only to messages that
   arrive unprompted, and only within 100px of the bottom; otherwise a "Jump to
   latest" pill appears, driven by the same predicate.
7. **Enter must not send on touch.** Soft keyboards have no Shift+Enter, so
   Enter-to-send makes multiline input impossible rather than merely awkward.
   Gate on `matchMedia('(pointer: coarse)')` — input capability, not device
   class — and always ship a visible send button.
8. **Shed the chrome on mobile, keep it on desktop.** Every chat-as-product
   (ChatGPT, Claude, Gemini, Perplexity, Copilot) uses a dedicated route with an
   off-canvas history drawer on mobile and a persistent collapsible rail on
   desktop. Every chat-inside-a-product (Notion, Slack, GitHub, Shopify Sidekick,
   Linear) uses a panel and keeps product nav visible. TTV's Ask AI is closer to
   the first — conversations are durable, revisitable objects — so a dedicated
   route is right, but the route back to the dashboard has to stay obvious.
9. **Material 3's full-screen-dialog test** is a good tiebreaker and Ask AI meets
   all three criteria: keyboard input, changes not saved instantly, and it opens
   further surfaces (citations).

## The spine

`ChatLayout.astro` plus the components in `src/components/chat/`:

- `100svh` → `100dvh` container, document cannot scroll.
- Header and composer are fixed-size flex siblings; the transcript is the only
  `overflow-y-auto` region, with `min-h-0 flex-1`.
- Composer is a flex child, never `position: fixed` — a fixed element is
  positioned against the layout viewport, which does not shrink for the keyboard.
- The transcript carries `tabIndex={0}` and a label. The document no longer
  scrolls, so without that, Page Up and Space stop working for anyone without a
  mouse.
- Announcements go to a dedicated offscreen `aria-live="polite"` element, *not*
  to the transcript container. Making the transcript itself a live region would
  read a whole saved conversation aloud every time one is opened, since loading
  one replaces every child at once.
- The conversation sheet is a native `<dialog>` opened with `showModal()`, so the
  focus trap, inert background, Escape and focus restoration come from the
  platform rather than from hand-rolled listeners.
- Assistant messages are flat blocks, not bubbles; only user messages get a
  bubble. Long-form output reads badly in a chat bubble.

On desktop the conversation rail scrolls independently. That is a second scroll
*column*, not a nested scroller, and it is what every comparable product does.
The e2e spec enforces at most one scrolling region on mobile and two on desktop.

## The three variants

| | A — Takeover bar | B — Icon rail, no header | C — Thumb-first sheet |
|---|---|---|---|
| Mobile chrome | 56px top bar: hamburger, title, ＋ | none — two floating pills over a scrim | 44px bar: back, title, ＋ |
| Conversation switch | left drawer | left drawer | bottom sheet |
| Switch trigger | hamburger, top-left | pill, top-left | pill directly above the composer |
| Back to dashboard | drawer header + app-nav footer | drawer header + app-nav footer | back arrow in the header |
| Desktop | 18rem rail with app nav pinned to its bottom | 4.5rem app icon rail + collapsible 18rem panel | 18rem rail, floating composer |
| Vertical space for messages on a Pixel 7 | baseline | +56px vs A | +12px vs A |
| Tradeoff | most conventional; the header is pure overhead | most content, but transcript ghosts under the pills and both controls are at the top, away from the thumb | switcher is thumb-reachable, but a bottom sheet is a less familiar place to find history |

**Shipped: A as the structure, with C's switcher.** A's labelled header is the
honest way to keep "you are inside TTV, here is the way back" visible, and B's
floating-pill approach buys 56px at the cost of legibility and reach.

C's switcher shipped in a cheaper form than the prototype used. Rather than
spending a row of chrome on a pill above the composer, the header *title* is the
switcher and opens a bottom sheet — so the list itself lands in the thumb zone,
which was C's actual insight, at zero pixel cost. The two elements are rendered
separately (`lg:hidden` button, `lg:inline` text) rather than as one button with
`pointer-events-none`, because that suppresses only pointer events: a keyboard
user could still activate it on desktop and open a `display: none` modal that
swallows every click on the page.

## Deliberately not decided here

- Whether `/dashboard/ask` should become a top-level `/ask` route now that it
  sheds `DashboardLayout`. It stays under `/dashboard/*` so the existing
  middleware auth guard keeps covering it.
- Streaming: the prototypes render finished messages. The scroll policy above is
  written for streaming but is not exercised by mock data.
- Whether the conversation list needs search, rename or delete. The prototypes
  show a flat recency list.

## Sources

- MDN: [`overscroll-behavior`](https://developer.mozilla.org/en-US/docs/Web/CSS/overscroll-behavior),
  [viewport units](https://developer.mozilla.org/en-US/docs/Web/CSS/length),
  [`env()`](https://developer.mozilla.org/en-US/docs/Web/CSS/env),
  [VirtualKeyboard API](https://developer.mozilla.org/en-US/docs/Web/API/VirtualKeyboard_API)
- Chrome for Developers: [viewport resize behavior](https://developer.chrome.com/blog/viewport-resize-behavior),
  [take control of your scroll](https://developer.chrome.com/blog/overscroll-behavior)
- WebKit: [bug 259770 — `interactive-widget` unimplemented](https://bugs.webkit.org/show_bug.cgi?id=259770)
- Apple Developer Forums: [safe-area insets report 0 in portrait](https://developer.apple.com/forums/thread/699415),
  [inset is 0 when the toolbar is hidden](https://developer.apple.com/forums/thread/716552)
- NN/g: [10 guidelines for AI chatbots](https://www.nngroup.com/articles/ai-chatbots-design-guidelines/),
  [explainable AI in chat](https://www.nngroup.com/articles/explainable-ai/),
  [mobile navigation patterns](https://www.nngroup.com/articles/mobile-navigation-patterns/)
- Material 3: [navigation drawer](https://m3.material.io/components/navigation-drawer/overview),
  [dialogs](https://m3.material.io/components/dialogs/guidelines)
- W3C: [modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)
- TanStack Virtual: [chat/end-anchored scrolling](https://tanstack.com/virtual/latest/docs/chat)
- Rocket.Chat [#35966](https://github.com/RocketChat/Rocket.Chat/issues/35966) — Enter-to-send
  making multiline input impossible on mobile
