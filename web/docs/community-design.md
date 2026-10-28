# Community pages

The October 2026 redesign extends the selected homepage's “Layers, mapped”
language: Mattone display type, peach/green/cream sheets, and connected circles,
rings and diamonds. Four public routes share the existing PublicLayout.

- `/community`: an illustrative network and three large linked participation
  cards. No real member data is loaded into this public illustration.
- `/community/members`: a layered green contribution file, with the member's own claim,
  source and scoped mentor context visibly separated.
- `/community/mentors`: a green review sheet with a peach scoped note.
  The FAQ advises agreeing scope/time; it invents no weekly-hours commitment.
- `/community/institutions`: a green evidence sheet, from search to source
  context to a human question. Approval and private-data boundaries remain explicit.

All pages render on the server; no React hydration, external imagery or new
runtime dependency is needed. Rounded surfaces share the homepage's materials,
and upright sections visibly slide over preceding sheets without shrinking or
dimming their contents. FAQ sections stay in document flow so disclosure
expansion does not move the tapped control. Sticky offsets follow content and
viewport size, preserving enough reading space before the next sheet arrives.

Persona illustrations use shallow stacked edges above an upright foreground
card. Decorative borders never cross the avatar, text or caption. Diagram
connectors stop at the final node, and dots, rings and diamonds use centered
CSS shapes instead of baseline-dependent text glyphs.

Illustration cards settle into place once they enter the viewport, after fonts
load. They stay opaque throughout and do not replay on reverse scrolling.
Clickable cards use an upright lift on fine-pointer hover; touch and keyboard
focus do not tilt the layout. Reduced motion disables animation and transitions.

Review covers intermediate scroll frames in both directions, hover, native
FAQ disclosures, menus and anchors on every route. In addition to full-page
text checks, browser regressions sample section geometry every 160px, require
visible sliding, stable summary positions on expansion/collapse, contained
illustration contents and decorative edges, centered markers, card separation and
upright hover, and check aligned gutters across phone/tablet breakpoints.
Screenshot reviews include 320px, 390px, 768px, 1440px and short landscape.
Sign-in return paths, signed-in CTAs, focus recovery and browser Back are also
covered. Static screenshots alone are insufficient evidence for motion quality.

Staging delivery reuses the previous homepage branch's exact-open-PR deployment
preflight. The optional deploy_pr selects a same-repository open PR only for
deploy; its full head SHA and dispatched branch must agree with GitHub. All
historical fixture/diagnostic actions retain their original scope. No merge or
production deployment is authorized until the owner reviews these pages.
