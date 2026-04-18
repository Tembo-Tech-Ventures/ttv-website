# TTV Website — Design Refresh Proposal

**Scope:** Direction only. No code changes. Based on a walkthrough of
`https://staging.tembotechventures.com` (desktop + mobile), paired with
research into 2026 tech-sector design trends and recent Awwwards winners in
adjacent categories (education, mission-driven, bold typography).

**Current brand equities worth keeping:**

- The chunky, reverse-contrast display face (Climate Crisis) is genuinely on
  trend — 2026 typography forecasts all call out chunky serifs/rounded heavy
  display type as a dominant direction (Fontfabric, Kittl, Creative Bloq). We
  lean **in**, not away.
- Orange `#F28D68` against dark teal `#013D39` is a real, ownable pairing.
  Most peers (Le Wagon, Ironhack, General Assembly) default to black + red or
  black + white; our warmth is a differentiator.
- Tembo = elephant = strength/wisdom/community. This is a story; we are
  currently telling it only in one small copy block.

**The problem in one sentence.** The current homepage uses one strong
asset — the chunky hero wordmark — and then falls back to generic dark-mode
SaaS patterns (centered stack, emoji-icon feature cards, bulleted values,
empty vertical whitespace). It reads as templated rather than authored.

---

## Screenshots referenced

Captured 2026-04-18 from staging, desktop 1440×900 and mobile 390×844:

- `screenshots/home-desktop.png` / `home-mobile.png`
- `screenshots/auth-login-desktop.png` / `auth-login-mobile.png`
- `screenshots/blog-index-desktop.png` — **404**. `/blog` is broken on the
  Cloudflare staging build (serves the Astro default error page). This is a
  separate bug, not a design issue, but worth calling out: blog is part of
  the public funnel.

---

## What I'd borrow from, and why

These are the reference points I'd design against, each chosen because they
share a constraint with us (bold brand, limited imagery budget, or
mission-driven tone):

| Reference | Why it's relevant | What to steal |
|---|---|---|
| **Lando Norris official site** — Awwwards Site of the Year 2025, by OFF+BRAND | Two-color palette (lime `#D2FF00` + near-black `#111112`), bold wordmarks, modular split (On Track / Off Track). | The idea of a single signature accent carried through *everything* — buttons, rules, numerals, hover states — instead of fading to grey. Scroll-driven motion on big type. |
| **Abadir Academy** — Awwwards HM, March 2026, by Frakas | Design school, similar audience age, two-color (black + red `#EA3323`), heavy type-led layout. | Oversized type used as layout itself — the headline *is* the hero, not sitting on top of one. Accessible and direct. |
| **Skillex Online Education** — Awwwards HM | Edtech multi-field platform, same product shape as us. | Clean categorical bento grid, strong program cards with outcome-first copy. |
| **Kunumi Institute** — Awwwards HM, April 2026 | Mission-driven tech institute. | Editorial pacing; every section has a distinct typographic treatment rather than all looking the same. |
| **Eventbrite rebrand** (Buck, 2025) | Proof that chunky serifs scale from logo to UI. | How to use one display face at many sizes without it feeling repetitive — by varying weight, slant, and tracking per role. |
| **Codrops "Exat" microsite** | Typography showcase reference. | Kinetic type-on-scroll patterns we can adapt at low cost. |

**Trends referenced (2026 forecasts):**

- Brutalism-as-confidence: heavy type, hard edges, restraint on ornament. Used
  by tech startups that want to signal they're not another Stripe clone.
  (Muzli, DesignMonks, Gezar)
- Bento-style modular grids replacing the old "three cards in a row" section.
  (Figma Resource Library, Elementor, Ariel Digital)
- Kinetic text / text-on-scroll as a first-class design element. (Creative
  Bloq, Wix, Envato)
- Variable fonts to let one family serve many roles at different weights/
  widths — cheaper than adding a second family. (Envato, Fontfabric)
- One signature accent color used with discipline — no rainbow palettes.

---

## Findings per surface

### 1. Homepage hero

**What's there:** Elephant logo, centered 2-line wordmark, 3-line tagline,
two buttons (Sign In with GitHub / Explore Programs), three `FOCUS / MODEL /
OUTCOME` info chips.

**Problems:**

1. The wordmark wraps to two lines on desktop (`Tembo Tech` / `Ventures`)
   which makes it feel thin and apologetic rather than deliberate.
2. "Sign In With GitHub" is a very high-commitment first CTA at the top of
   the funnel. Most visitors don't know us yet.
3. The three chips (FOCUS/MODEL/OUTCOME) are a miniature three-column feature
   pattern. They tell the reader *nothing* they didn't already get from the
   tagline.
4. No motion, no texture, no image, no proof — just air.
5. The dark teal background sits perfectly flat. It reads as "default MUI
   dark mode" rather than "Tembo brand."

**Direction:**

- Let the wordmark break the grid. A single word like **TEMBO** set
  massive (say, 240px/clamp) on one line, with the rest of the brand name
  ("TECH VENTURES") sitting beneath it in a smaller, tightly tracked
  sans-serif. This is how Abadir and Lando Norris handle it: one word
  does the work, the rest is a kicker.
- Replace the tagline with a single editorial sentence that earns the space.
  E.g. a short declarative like *"We train underrepresented talent into
  delivery-ready software engineers — then we keep mentoring them."* Treated
  as a quote, not marketing copy.
- Primary CTA: **"Explore Programs"** (lower friction). Secondary: "Sign in"
  demoted to a link in the top-right nav. GitHub-specific sign-in is an
  implementation detail and shouldn't be the front-door verb.
- Drop the FOCUS/MODEL/OUTCOME chips. Replace with *one* piece of hard
  social proof — a stat, a named graduate with an employer logo, or a cohort
  count. ("43 graduates. 9 employer partners. 82% placement within 6 months.")
  If the numbers aren't there yet, leave the space for them; don't fill it
  with vibes.
- Add texture. The dark teal needs one of: a subtle film-grain noise layer,
  a low-contrast terrazzo/elephant-print pattern in the background at ~4%
  opacity, or a soft radial orange bloom behind the wordmark. Pick one.
  This is the cheapest move with the biggest visual payoff.
- Keep the GSAP scroll-parallax on the wordmark — that's already good.
  Extend it: let the elephant and wordmark move at different rates so the
  hero has depth on scroll.

### 2. Navigation

**What's there:** Wordmark (small, orange) / Home / Why Tembo / Programs /
Values / Sign In (pill button).

**Problems:**

- The nav wordmark uses the same chunky face at a small size, where it
  loses legibility. Climate Crisis is a display font; it isn't meant for
  16–20px.
- "Home" as a link is redundant (the wordmark is always the home link).
- "Values" as a nav item is unusual — most visitors aren't looking for your
  values page from a top nav.

**Direction:**

- Nav wordmark → a monogram mark (the elephant alone, or a "TTV" monogram in
  a tight sans) for any size below ~28px. Save Climate Crisis for ≥48px.
- Nav items: `Programs · Mentors · Impact · Blog`. Promote Impact (outcomes
  + stories) above Values — it earns the click and says the same thing
  more specifically. "Why Tembo" collapses into the homepage; it's a
  scroll target, not a destination.
- Sign In → right-most, ghost button (outline only) unless logged-out
  users need it. Primary CTA in the nav should be **Apply** once programs
  are open, which is also the site's main conversion goal.

### 3. "Why Tembo" card

**What's there:** Bordered card with the Swahili "Tembo = elephant" story and
mission copy.

**Problems:**

- Rounded card with gradient border is a bootstrapped-SaaS pattern. The copy
  inside is actually the best writing on the site; the container is hiding
  it.
- "Our mission is to bridge the gap…" is strong. It should be *huge*.

**Direction:**

- Blow this out of the card. Set the definition line —
  `Tembo (n.) — elephant. Swahili.` — as an editorial dictionary entry,
  small-caps, left-aligned, with the illustration of an elephant in
  hand-drawn line art at the right. Then the mission statement as a pull
  quote at 48–72px, left-aligned, using the chunky face. No container.
- This is one of the two moments where we should feel most human.

### 4. "What We Do" — Training / Mentorship / Impact

**What's there:** Three equal cards, each with an emoji (🎓 🤝 🌍), a chunky
orange heading, and three lines of body copy.

**Problems:**

- The Apple-style emojis clash hard with the rest of the page. They're a
  different visual language (rendered full-color vector illustrations) and
  they undercut the otherwise bold, editorial tone. This is the single
  biggest hit to perceived quality on the page.
- The chunky face at ~24px (card heading size) is where Climate Crisis
  becomes hard to read — notice how "Training" reads almost like "Tranng"
  at that size in the screenshot.
- Three equal cards is the safest, least memorable layout in tech.

**Direction:**

- Kill the emojis. Replace with either:
  1. Custom monoline icons (training = mortarboard, mentorship = two heads,
     impact = elephant silhouette) in orange at ~48px. Cheap to commission
     or draw inline SVG. OR
  2. Oversized editorial numerals — **01 Training · 02 Mentorship · 03
     Impact** — using the chunky face at 120px as the visual anchor, with
     body copy sitting quietly beside.
- Switch to a **bento layout**: one wide card (Training, the hero program),
  two smaller cards stacked (Mentorship, Impact). Asymmetry communicates
  priority. This is what Skillex and most 2026 edtech references do.
- For the small-size type in those cards, switch the heading font to Maven
  Pro Bold rather than Climate Crisis. Reserve Climate Crisis for the
  category label above the card ("01 · TRAINING") where it can be set at
  a size that respects the typeface.

### 5. "Our Values" section

**What's there:** Five items (Empowerment / Impact / Equity / Community /
Innovation), each a small row with an orange numbered circle + title + one
line of copy.

**Problems:**

- Five near-identical rows, all the same size, all ending in a period.
  Nothing for the eye to catch on.
- The numbered circles feel 2018 pricing-page.
- Every value is an abstract noun. None of them are specific to us yet.

**Direction:**

- Ditch the table/list. Treat the five values as **one kinetic sentence**,
  like a poster. Each value is a word set massive (Climate Crisis at 160px),
  stacked vertically:

  ```
  EMPOWERMENT.
  IMPACT.
  EQUITY.
  COMMUNITY.
  INNOVATION.
  ```

  Each word fills the screen width. The supporting sentence for each value
  sits to the right of its word at ~18px body size, vertically centered.
  Scroll-triggered: each word slides in from the left as you hit it. This
  is the Abadir/Kunumi move, and it is how brutalist sites handle lists.
- Alternatively, make each value a **named commitment**, not an abstract
  noun: *"We pay mentors."* / *"We accept people without degrees."* /
  *"We don't lock learners behind income-share agreements."* That's how
  values become proof. Short, declarative, specific.

### 6. Login page

**What's there:** Wordmark centered, single GitHub sign-in button, one line
of legal.

**Problems:**

- The screen is 80% empty. On a dark background that reads as "broken."
- "Sign in to access your dashboard" is the system's voice, not ours.

**Direction:**

- Split 50/50. Left side: the sign-in form (unchanged). Right side: a
  rotating testimonial card with a named graduate, their current employer,
  and one sentence. Or, for zero-content launch: a hand-drawn full-bleed
  elephant illustration in single-color line art against the teal.
- Copy: replace system voice with brand voice. *"Welcome back. Pick up
  where you left off."* or *"Sign in and get back to building."*

### 7. Footer

**What's there:** `© 2026 Tembo Tech Ventures. All rights reserved.` · Programs · Sign In.

**Direction:** The footer is real estate. Add: mission statement (one line),
programs list, blog link, careers, contact, social (LinkedIn at minimum),
and a large wordmark at the bottom bleeding off the page edge as a "signature."
Most awarded sites treat the footer as the second hero.

### 8. Blog (broken on staging)

`/blog` returns the Astro 404 template on staging. Before any design work,
this needs to be wired up on the Cloudflare staging deployment. This is a
correctness bug, but it matters for the design proposal because the blog is
currently the only content-marketing surface and should carry some of the
hero treatment (oversized post titles, editorial list layout, named authors
with photos).

---

## System-level moves

These are settings changes, not per-page changes — they lift the whole site
at once.

### A. Typography system

Right now we have two typefaces and a ladder of MUI h1–h6 sizes. That's fine,
but everything from h1 to h3 is Climate Crisis, which forces the same visual
weight everywhere.

Proposed role split:

| Role | Typeface | Size | Example |
|---|---|---|---|
| Hero wordmark / section anchors | Climate Crisis | 120–240px clamp | "TEMBO" |
| Section heading | Climate Crisis | 56–80px | "WHAT WE DO" |
| Card/block heading | Maven Pro Bold, tight tracking, uppercase | 18–22px | "01 · TRAINING" |
| Body | Maven Pro Regular | 18–20px | — |
| Editorial pull quote | Climate Crisis, italic/slanted if available | 40–56px | — |
| UI labels | Maven Pro Medium, uppercase, letter-spaced | 12px | "FOCUS" |

This keeps Climate Crisis' impact but stops it doing the job it can't do
(small, dense, running text).

### B. Color system

Keep the two brand colors. Add **one** warm highlight and a texture layer.

| Token | Current | Proposed | Use |
|---|---|---|---|
| `bg.primary` | `#013D39` | `#013D39` | Default |
| `bg.raised` | `#2C6964` | `#063F3A` (darker) | Cards that need to recede |
| `accent.primary` | `#F28D68` | `#F28D68` | Buttons, links, accents |
| `accent.bright` | — | `#FFD166` (warm yellow) | Rare highlight moments (stat callouts, "new" badges) |
| `ink.primary` | `#FFFFFF` | `#FFF8F2` (warm off-white) | Body text — a 5% warm tint stops the page reading as clinical |
| `rule` | — | `rgba(242,141,104,0.2)` | Hairline dividers |

Add a film-grain noise layer at ~3–5% opacity as a fixed background element.
This alone makes a dark theme feel authored rather than default.

### C. Motion system

Current motion: GSAP parallax on hero title and elephant. Good foundation.

Add:

1. **Scroll-linked type reveals** on section headings (lines rise in from
   below with 30–80ms stagger per character).
2. **One horizontal marquee** somewhere — partner logos, or a repeating
   "EMPOWER · IMPACT · EQUITY · COMMUNITY · INNOVATION ·" band between
   sections. This is the single most recognizable 2026 tech-site gesture.
3. **Elephant mascot movement** — currently the elephant is a static SVG.
   Even a gentle breathing animation (`scale: 1 → 1.02`, 4s ease-in-out
   loop) turns a logo into a character.

All of the above are cheap (GSAP is already in the stack) and all
respect `prefers-reduced-motion` by default.

### D. Imagery strategy

Biggest missing thing on the site: **human faces**. Nobody is on this
website. That's fatal for a program whose value prop is people helping
people.

- Commission (or source from cohort) portraits of 6–8 graduates, mentors,
  and instructors.
- Treat them with a consistent filter — desaturated, warm shadow, slight
  orange duotone. This lets us mix photo quality levels and still look
  coherent.
- Place one face on the hero (as a secondary element behind the wordmark
  or to the right), one in the testimonials strip, one in the footer
  "join us" callout.

---

## Priority / phasing

If I had to stage this, I'd order by impact-per-effort:

**Phase 1 — quick wins (1–2 days each):**

1. Remove Apple emojis from "What We Do"; swap to monoline SVG or oversized
   numerals.
2. Demote "Sign in with GitHub" below "Explore Programs" in the hero.
3. Fix `/blog` 404 on staging Cloudflare build (engineering, not design).
4. Add film-grain noise layer + warm off-white body text.
5. Rework nav: drop "Home", promote "Blog" and eventually "Apply".

**Phase 2 — core redesign (1–2 weeks):**

6. Hero reflow — single-line "TEMBO" wordmark, editorial tagline, one proof
   stat, new texture.
7. "Our Values" as kinetic stacked word poster with named commitments.
8. "What We Do" bento layout.
9. Typography role split (Climate Crisis only above 48px).

**Phase 3 — depth (ongoing):**

10. Commission graduate/mentor portraits + duotone treatment.
11. Blog editorial redesign.
12. Login split screen with testimonial.
13. Marquee band between sections.
14. Richer footer.

---

## Sources

- [Awwwards — Lando Norris (Site of the Year 2025)](https://www.awwwards.com/sites/lando-norris)
- [OFF+BRAND — Lando Norris case study](https://www.itsoffbrand.com/our-work/lando-norris)
- [Awwwards — Abadir Academy (Honorable Mention, March 2026)](https://www.awwwards.com/sites/abadir-academy)
- [Awwwards — Skillex Online Education](https://www.awwwards.com/sites/skillex-online-education)
- [Awwwards — Culture & Education collection](https://www.awwwards.com/websites/culture-education/)
- [Awwwards — Typography-Heavy Web Design](https://www.awwwards.com/typography-heavy-design.html)
- [Fontfabric — Top 10 Design & Typography Trends for 2026](https://www.fontfabric.com/blog/10-design-trends-shaping-the-visual-typographic-landscape-in-2026/)
- [Creative Bloq — Top typography trends for 2026](https://www.creativebloq.com/design/fonts-typography/breaking-rules-and-bringing-joy-top-typography-trends-for-2026)
- [Kittl — Top font trends 2026](https://www.kittl.com/blogs/top-font-trends-dsi/)
- [DesignMonks — Typography Trends 2026](https://www.designmonks.co/blog/typography-trends-2026)
- [Figma — Top Web Design Trends for 2026](https://www.figma.com/resource-library/web-design-trends/)
- [Gezar — 11 Web Design Trends in 2026](https://gezar.dk/en/blog/web-design-trends-2026)
- [Muzli — Web Design Trends 2026](https://muz.li/blog/web-design-trends-2026/)
- [Codrops — Exat Microsite (typography showcase)](https://tympanus.net/codrops/2026/04/10/the-exat-microsite-pushing-a-typography-showcase-to-new-creative-extremes/)
- [Awwwards — 25 Non-profit and Social-Driven Websites](https://www.awwwards.com/25-non-profit-and-social-driven-websites.html)
- [Le Wagon](https://www.lewagon.com/)
- [Ironhack](https://www.ironhack.com/)
