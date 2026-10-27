# Community pages

The October 2026 redesign extends the selected homepage's “Layers, mapped”
language: Mattone display type, peach/green/cream sheets, and connected circles,
rings and diamonds. Four public routes share the existing PublicLayout.

- `/community`: an illustrative network and three large linked participation
  cards. No real member data is loaded into this public illustration.
- `/community/members`: a cream contribution file, with the member's own claim,
  source and scoped mentor context visibly separated.
- `/community/mentors`: a peach review sheet with a marked review passage.
  The FAQ advises agreeing scope/time; it invents no weekly-hours commitment.
- `/community/institutions`: a pale-green evidence sheet, from search to source
  context to a human question. Approval and private-data boundaries remain explicit.

All pages render on the server; no React hydration, external imagery or new
runtime dependency is needed. Motion is CSS progressive enhancement: finite
network pulses, sheet arrival, focus/hover card lift, and view-timeline sheet
entry where supported. Reduced motion disables animations and transitions.

Screenshot iteration covered 1440px desktop and 390px mobile, then automated
320px enlarged-text and intermediate-width checks. First review found closing
marks crowded mobile headings; the second pass places them above the heading,
tightens mobile cards and adds restrained sheet entry. Browser text-integrity
checks walk all four pages to detect clipped/covered/unreadable text. Native
FAQ disclosures, sign-in return paths, signed-in CTAs and focus indicators are
covered by component tests and Playwright.

Staging delivery reuses the previous homepage branch's exact-open-PR deployment
preflight. The optional deploy_pr selects a same-repository open PR only for
deploy; its full head SHA and dispatched branch must agree with GitHub. All
historical fixture/diagnostic actions retain their original scope. No merge or
production deployment is authorized until the owner reviews these pages.
