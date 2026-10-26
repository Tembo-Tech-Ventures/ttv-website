# Homepage simplification

Direction reviewed with Opus 5.5: give each idea one place. Retain Mattone,
Maven Pro, dark green and peach; replace the repeated values carousel/list,
marquee and dictionary section with a static introduction, practical explanation,
three audience routes and three distinct commitments. Real public builders and
published posts remain separate data-backed sections.

The hero now leads to the member journey (preserving the GitHub return path),
with one secondary anchor explaining participation. Audience rows link to their
existing detailed pages and state the institutional approval requirement.
The existing How and Why fragments now answer how participation works and what
principles guide it. No new cohort availability claim is made.

The stale cohort/stat strip and “profiles land with Cohort 04” copy are removed.
The owner-written internship count in the old HONESTY commitment is replaced
with a non-quantified statement that contributions/feedback do not guarantee a
job or introduction; the historical count was not reverified for this release.

Motion is CSS-only: a short entrance, scroll-linked divider drawing where the
browser supports it, and arrow/rule feedback on keyboard focus or hover. Content
starts visible; unsupported scroll timelines remain static. Reduced-motion users
get no entrance, scroll or hover animation. No homepage hydration or GSAP bundle.

## Local evidence

- `desktop.png`: real server-rendered homepage components at 1440px.
- `mobile.png`: the same components at 390px.
- These are component harness captures, not a deployed full-page capture. They
  exclude the existing navigation, footer and database-backed profiles/posts.
- Playwright covers 320, 390, 768, 1440 and 2560px; text enlargement, keyboard
  focus/links, reduced motion, signed-in destinations and disabled JavaScript.
- Shared homepage assertions also run in the live layout-integrity suite.
- Unit tests cover distinct commitments, state-aware entry, audience scope,
  retained fragments and removal of the legacy page composition.

Staging is the requested delivery target. Production merge requires a separate
owner release decision. The staging dispatch now accepts an optional deploy-only
PR number after PR171 merged, with exact open same-repository PR/branch/SHA checks
unchanged; fixture/diagnostic actions retain their previous pinned scope.
