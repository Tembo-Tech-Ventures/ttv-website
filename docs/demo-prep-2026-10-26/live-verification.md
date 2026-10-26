# Live staging verification — 2026-10-26

Deployed revision: `ee9b88e0947a05399feb134f3999ad60f198dccb`.
URL: https://staging.tembotechventures.com/demo

- [PR216](https://github.com/Tembo-Tech-Ventures/ttv-website/pull/216) merged only into staging integration PR171.
- [Staging deployment and browser verification](https://github.com/Tembo-Tech-Ventures/ttv-website/actions/runs/40313784368): SUCCESS. The slow browser installation finished; the cancellation attempt had no effect because the run had already completed. No replacement deployment was dispatched.
- [Same-revision read-only seed diagnosis](https://github.com/Tembo-Tech-Ventures/ttv-website/actions/runs/40315870741): SUCCESS, attempt 1. Executor and independently checked live revision both match the deployed revision above. Fixed aggregate SELECTs only; no reseeding, user/session creation, credential changes, or human-record edits.
- Live health: staging, expected revision, status `ok`, database `ok`.
- Anonymous checks: `/demo`, switch and return all 401; chooser controls absent; foreign-origin switching 403; admin/member dashboard redirect to login. Sensitive denial responses use `no-store`. See [the sanitized receipt](./live-anonymous-smoke.json).
- Actual retained data: 150 synthetic people with matching synthetic-email provenance; 150 profiles; 272 contributions; 90 confirmations; 74 cohort applications; one retained curriculum and program. All four fixed personas passed identity, exact role and cohort readiness checks. See [read-only seed receipt](./live-seed-readiness.json). The historical STUDENT role is absent; the fixed cohort persona intentionally has no global role and uses its approved program application, as the current server gate requires. No role was added.
- Bounded Worker-tail artifact: 92 lines / 87 request events, no error or exception markers. This is evidence from that verification window, not a claim about all historical traffic. Raw logs and identities are not copied here.
- Automatic staging Playwright: 67 passed, 311 skipped. These general checks do **not** prove the human admin impersonation walkthrough.
- Source checks: CI lint, tests and security PASS; Astro type check and preview browser verification PASS. Local full regression: 195 files / 2,432 tests, lint and TypeScript pass. Follow-up diagnosis: 18 focused tests and script lint pass. Local demo UI: desktop 1440 / mobile 390 browser checks pass, including confirmation, keyboard focus and fixed admin navigation.

## Remaining human step

No real browser-authenticated staging ADMIN session was available to the agent or
PM. The human OAuth → chooser → member/mentor/institution → return-to-original-admin
walkthrough remains **not performed live**. No bearer workaround or synthetic
human-admin credential was created. Server authorization/restoration is covered
by real-SQLite tests; the committed screenshots are explicitly local UI fixtures.
Use the [presenter instructions](./README.md) while signed in with the existing
staging GitHub ADMIN account. Demo access ends at 23:00 UTC today; individual
persona sessions last at most one hour.

## Separate preview cleanup limitation

Automatic PR216 preview cleanup [run40313689526](https://github.com/Tembo-Tech-Ventures/ttv-website/actions/runs/40313689526)
failed while safely deleting `ttv-website-files-agent-pr-216`: R2 listing completion
metadata could not be verified. No forced deletion or unrelated cleanup was
attempted. This preview resource may remain and needs a separately authorized
cleanup follow-up; it does not affect the shared staging demo or retained data.
