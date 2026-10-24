# Community UI evidence — 24 October 2026

Source revision: `918c6ca3fe73793b13971d9a227a9abddba09d12` (UI PR #173; integration target #171).

These captures show actual React components in the **local component harness**, using **fictional profiles and a sample answer**. They are not authenticated staging evidence or proof of a live model response. Captured by `npx playwright test --config e2e/community-playwright.config.ts` in `web/`.

Flow: filter profiles, open Amara's evidence, inspect a mentor's claim-specific method/revision, and ask a suggested question. Desktop places evidence beside chat; mobile stacks the same content. The fictional demo banner remains visible.

- [Desktop profile and evidence chat](desktop-profile.png)
- [Mobile profile and evidence chat](mobile-profile.png)

Validation at source revision: 1,502 unit tests, lint, typecheck, and 22 desktop/mobile component browser cases passed. API interaction cases use mocked responses; live service and persona checks remain an integration/staging gate owned by PM.
