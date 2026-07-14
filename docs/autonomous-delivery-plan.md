# Autonomous delivery plan

## Goal

Make routine TTV changes flow from a well-scoped request to a tested pull
request with an agent-verified Cloudflare deployment. Humans should spend their
time choosing direction and approving risk, not rebuilding context, operating
deployment commands, or discovering whether the deployed code is the right
revision.

The target loop is:

```text
request or trigger
  -> plan and risk classification
  -> implementation plus tests
  -> static verification
  -> isolated Cloudflare deployment
  -> smoke, authenticated E2E, and log inspection
  -> independent review
  -> PR and human approval
  -> production deploy, verification, and rollback if needed
```

This is an implementation plan, not a proposal to let an unconstrained agent
write directly to production.

## Audit snapshot: July 2026

### Application

The application is a single `web/` package built with Astro 6, React islands,
Tailwind 4, Better Auth, Drizzle, and Vitest. Cloudflare provides Workers, D1,
R2, Images, Queues, Vectorize, AI Gateway/Workers AI, Durable Objects, and an
FFmpeg Container.

The Cloudflare provisioning code is already unusually reusable: it can create
named environments, generate the deployed Wrangler configuration, apply D1
migrations, upload Worker secrets, and protect production teardown. That is the
right foundation for agent-owned preview environments.

The baseline before this work was 24 passing tests in four files. CI ran lint
and tests, but not type checking, build verification, browser tests, accessibility
checks, deployment identity checks, or live smoke tests. Lint passed with ten
existing warnings.

Pull requests deploy to one shared `staging` environment. Production deploys
automatically when `main` changes. A shared mutable staging target makes parallel
agents race and lets one PR accidentally verify another PR's build.

### Recent delivery pattern

Recent work moved the app from Next.js/Vercel to Astro/Cloudflare, built the
student/admin experience and data migration tools, refreshed the design and
Africa-focused copy, added the recording/transcription/search pipeline, moved AI
traffic to Cloudflare AI Gateway, fixed OAuth and deployment failures, and added
avatar uploads.

SAM agents delivered much of that work, but the history is still reactive:
individual tasks repeatedly rediscovered staging, registry, OAuth, local binding,
and obsolete Vercel issues. Several sessions grew to hundreds or thousands of
messages. Important knowledge exists in SAM, while repeatable execution contracts
do not yet exist in the repository.

### SAM project

SAM currently exposes 99 tools across task orchestration, missions and dependency
graphs, profiles, reusable skills, cron triggers, knowledge/policies, session
history, workspace networking, GitHub-oriented task handoff, artifact libraries,
and agent-first deployment with logs.

The TTV project currently uses only a small part of that surface:

| Capability | Current state | Consequence |
| --- | --- | --- |
| Agent profiles | Three general chat profiles | No dedicated implementer, reviewer, or release authority |
| Skills | None | Every task reconstructs the workflow from prose |
| Deployment environments | None accessible to this agent | SAM cannot currently provide routes or logs |
| Missions/dependency graph | No active missions or queue | Larger features are not automatically decomposed or reviewed |
| Triggers | Creation/update tools exist; no repository contract | No scheduled maintenance or content loop is defined |
| Knowledge/policies | Valuable project constraints exist | Decisions are remembered, but execution is not standardized |
| Credentials | SAM credential status missed the working GitHub CLI session; Cloudflare scope was not verified | Agents must check the actual tool and target authority before mutation |

SAM's built-in deployment system is Compose-based and intentionally bypasses CI.
It is useful for container stacks, but it is not the target runtime for TTV.
Moving this app there would violate the Cloudflare-only architecture decision.
For TTV, SAM should dispatch and coordinate agents while the repository's
Cloudflare tools provide deployment and runtime logs.

### Risks found at baseline

1. `npm audit` currently reports 19 advisories, including a critical direct
   Better Auth advisory and high-severity direct/transitive Astro, Wrangler,
   Vite, and Cloudflare development dependencies. This must be handled before
   expanding agent authentication.
2. Staging agent authentication was previously explored but is absent from
   `main`; the old output branch is no longer available.
3. The shared PR staging environment is unsafe for concurrent autonomous work.
4. There is no browser/E2E harness, accessibility gate, visual regression check,
   or authenticated staging smoke suite.
5. Production deploys on every merge to `main`, without a repository-level
   post-deploy health or rollback workflow.
6. The obsolete Vercel integration still produces a failing external status and
   must be disabled outside this repository.

## Foundation implemented in this branch

This branch establishes the first executable slice:

- `AGENTS.md` makes SAM startup, ephemeral workspace behavior, tests, Cloudflare
  constraints, live iteration, and handoff requirements discoverable to every
  coding agent.
- `npm run cf:agent -- context|deploy|tail|destroy` creates a protected
  task-isolated Cloudflare environment, deploys the checked-out revision, runs
  live smoke checks, exposes Worker logs, and refuses non-`agent-*` targets.
- `/api/health` exposes non-secret environment and version identity and bypasses
  session lookup so deployment health remains observable when auth is broken.
- `npm run cf:smoke` verifies health, revision/environment identity, and the
  public homepage.
- Environment teardown now covers Queue, Vectorize, and AI Gateway as well as
  Worker, D1, and R2, reducing leaked preview resources.
- Generated deployments now include the Cloudflare Images binding required by
  avatar uploads.
- CI now runs `tsc --noEmit` in addition to lint and unit tests.
- All executable additions have Vitest coverage.

The direct workspace build/deploy path still needs a scoped Cloudflare token and
Docker. The repository now also provides a GitHub-hosted isolated workflow that
uses staging-scoped credentials while targeting only a separately named
`agent-*` stack.

## Automation implemented: July 2026

- Compatible dependency upgrades removed all known critical/high advisories.
  CI now enforces that threshold; the remaining low/moderate development-chain
  findings require Astro 7 or upstream Drizzle/Better Auth changes.
- Staging-only bearer sessions are admin-minted, expiring, revocable,
  same-origin protected, displayed once, and rejected by deploy configuration
  outside `staging` and `agent-*`.
- Playwright covers health/revision identity, homepage, login, and optional
  bearer-authenticated dashboard/admin journeys. Every Cloudflare deploy runs
  smoke and browser verification automatically.
- Shared staging and production deployments have concurrency guards.
  `Cloudflare Agent Environment` supplies GitHub-hosted isolated deploy/destroy
  with staging-scoped credentials; `Cloudflare Agent Environment Cleanup`
  supplies credentialed dry-run-first cleanup.
- A stale-resource sweeper selects only this app's `agent-*` Workers, requires
  at least a six-hour window, defaults to 72 hours and dry-run, supports active
  exclusions, and preserves the stack when an R2 bucket cannot be safely
  deleted.
- SAM now has dedicated planner, implementer, independent reviewer, release,
  content, and maintenance profiles. It has six corresponding skills:
  `ttv-plan-feature`, `ttv-feature-delivery`, `ttv-content-update`,
  `ttv-independent-review`, `ttv-release`, and `ttv-maintenance`.
- Active single-concurrency SAM triggers run dependency/security maintenance
  Monday at 06:00 UTC, content/link health Wednesday at 07:00 UTC, and stale
  environment cleanup daily at 03:30 UTC.
- The desired main ruleset is versioned at `.github/rulesets/main.json` and
  tested with the workflows. Activation is waiting on GitHub Administration
  permission for the current automation identity.

## Target operating model

### 1. Intake and classification

Every request becomes a SAM task with explicit acceptance criteria, affected
surfaces, risk class, and a test plan. A planner profile searches project
knowledge, recent tasks, ideas, and active agents before making architecture or
content decisions.

Risk classes:

- **Low:** copy, styles, isolated content, and non-functional metadata.
- **Medium:** UI behavior, ordinary APIs, queries, and non-destructive schema
  additions.
- **High:** auth, roles, secrets, destructive migrations, recording processing,
  deployment code, billing, and production infrastructure.

Low and medium changes may progress automatically to a ready-for-review PR.
High-risk work requires an explicit human checkpoint before live mutation and a
second human checkpoint before production.

### 2. Purpose-built SAM profiles

The following profiles now exist; credentials remain external and least-privilege:

| Profile | Permissions | Purpose |
| --- | --- | --- |
| Planner | Plan/read-only, high reasoning | Scope work, query history, create mission graph and acceptance contract |
| Implementer | Edit, test, scoped Cloudflare preview deploy | Build one bounded task and iterate against logs |
| Reviewer | Read-only, separate context | Review diff, tests, security, UX, and live evidence |
| Release operator | Minimal GitHub/Cloudflare authority | Promote approved revisions, verify production, initiate rollback |
| Content maintainer | Limited paths and low-risk skill | Refresh approved site content without touching auth or infrastructure |

Cloudflare and GitHub credentials belong in profile-scoped secret environment
variables. The implementer must be unable to target production. The release
operator should be unable to make code edits. Use separate Cloudflare tokens with
the smallest resource permissions that the current deploy script needs.

### 3. Reusable SAM skills

The core delivery skills are:

1. **`ttv-feature-delivery`**: inspect history, baseline, implement with tests,
   deploy an isolated Cloudflare environment, run smoke/E2E, inspect logs, and
   open a PR with evidence.
2. **`ttv-content-update`**: search content-style knowledge, preserve the Africa
   focus and community framing, change approved content paths, run content/link/
   accessibility checks, and prepare a visual preview.
3. **`ttv-independent-review`**: receive only the acceptance contract, diff, and
   evidence; run targeted adversarial tests and return blocking/non-blocking
   findings.
4. **`ttv-release`**: require an approved PR and green gates, deploy the exact
   commit, verify health identity and critical journeys, monitor logs, and roll
   back on a defined threshold.
5. **`ttv-plan-feature`**: convert requests and project history into explicit
   acceptance, risk, dependency, and evidence contracts.
6. **`ttv-maintenance`**: perform bounded dependency, security, operational,
   and cleanup work without feature drift.

Skills should encode commands and evidence schemas, not product decisions.
Knowledge and project policies remain the source for durable preferences.

### 4. Mission graph for a feature

A feature mission should create dependency edges rather than one enormous chat:

1. planner publishes acceptance criteria, risk, affected contracts, and test plan;
2. implementer changes code and tests;
3. preview verifier deploys the implementer's branch and records URL, revision,
   smoke/E2E results, and relevant logs;
4. independent reviewer inspects code and evidence;
5. release task becomes schedulable only after implementation, preview, and
   review succeed.

Each task publishes structured mission state: assumptions, decisions, risks,
artifact/PR references, environment name, deployed revision, and cleanup status.
This lets a replacement agent continue without replaying a thousand-message
session.

### 5. Live verification

Add Playwright with two suites:

- unauthenticated: homepage, login, redirects, public certificate, health, core
  responsive layouts, accessibility, and console/network errors;
- authenticated: admin and student journeys, avatar upload, application flow,
  recording upload/processing/viewing, transcript sync, and Ask AI citations.

Before authenticated automation, upgrade Better Auth and implement staging-only
agent credentials. The short-term option is the official Better Auth bearer
plugin with admin-minted, expiring, revocable sessions and a production-off
feature flag. A later capability-scoped design may use Better Auth Agent Auth,
but its own documentation currently labels the protocol unstable; do not make it
the critical release dependency yet.

Every preview verification record must contain:

- exact Git revision and environment reported by `/api/health`;
- unit, type, lint, and browser results;
- the preview URL;
- relevant Cloudflare log excerpts or an explicit no-error observation window;
- migration and cleanup results;
- screenshots for visual changes;
- reviewer verdict.

### 6. Production safety

Keep production on Cloudflare and add a protected GitHub production environment.
The release operator promotes only an approved commit. Production verification
must check health identity, homepage, login, one read-only authenticated journey,
Queue/Container error rates, and AI Gateway failures.

Define rollback before enabling auto-promotion:

- retain the last known-good Worker version;
- make migrations additive/expand-contract until rollback is no longer needed;
- stop promotion on health, auth, migration, or error-budget failure;
- roll back the Worker first, then open a repair task with the failed evidence;
- never automatically reverse a destructive data migration.

## Phased implementation

### Phase 0: restore a trustworthy baseline

1. Upgrade Better Auth to a non-vulnerable release and run OAuth/session
   regression tests.
2. Upgrade Astro, the Cloudflare adapter, Wrangler, Vite, Kysely, and affected
   transitives; reduce `npm audit` to an agreed threshold.
3. Add an audit gate for critical/high production vulnerabilities and a scheduled
   dependency maintenance task.
4. Disable the stale Vercel project integration in Vercel/GitHub settings.
5. Make lint warnings non-increasing, then eliminate the existing ten warnings.

Acceptance: all current tests pass; auth and build smoke pass in an isolated
Cloudflare environment; no known critical production dependency advisory remains.

### Phase 1: complete the preview contract

1. Land this branch's health, smoke, isolated environment, logs, cleanup, and
   agent instructions.
2. Configure a Cloudflare preview token and OAuth secrets on the implementer
   profile; do not add them to the repository.
3. Exercise `cf:agent deploy -> tail -> destroy` against a real task and verify
   all resources are removed.
4. Add a stale-environment sweeper with a dry-run default and age/tag guard.
5. Add concurrency protection to the legacy shared staging workflow until all
   PR verification uses isolated environments.

Acceptance: two concurrent agents can deploy and verify distinct revisions
without overwriting each other, and cleanup leaves no task resources.

### Phase 2: authenticate and test real journeys

1. Implement staging-only agent credentials after the Better Auth upgrade.
2. Add token creation, expiry, revocation, audit records, and redacted UI.
3. Install Playwright and seed a minimal deterministic preview dataset.
4. Add authenticated smoke/E2E coverage and screenshot/artifact capture.
5. Add structured request/release IDs to Worker logs and a bounded log reader
   command for post-deploy verification.

Acceptance: an agent can authenticate without a human browser session, perform
only approved staging actions, and produce reproducible evidence for core journeys.

### Phase 3: encode the SAM workflow

1. Create the planner, implementer, reviewer, release, and content profiles.
2. Create the four TTV skills and test each on a small real task.
3. Use missions and dependency edges for features spanning more than one
   bounded change.
4. Add cron triggers for weekly dependency/security maintenance, stale preview
   cleanup, and broken-link/content freshness checks.
5. Configure issue/webhook triggers through the SAM UI or REST API once their
   filters and one-time credentials are approved.

Acceptance: a labeled issue can produce a tested, live-verified, independently
reviewed PR without manual orchestration.

### Phase 4: controlled autopilot

1. Auto-merge only allowlisted low-risk changes when every gate is green.
2. Require human approval for medium/high risk and all production auth, schema,
   infrastructure, or secret changes.
3. Add canary/error-budget rules and automatic rollback for reversible Worker
   releases.
4. Track delivery metrics and tune profile cost/effort from real failure data.

Acceptance: routine content and isolated UI changes need one human approval or
less; higher-risk features arrive as review-ready PRs with live evidence.

## Metrics

Track these per task and per month:

- request-to-first-preview and request-to-review-ready time;
- percentage of tasks producing a live preview and complete evidence;
- first-pass CI and preview success rates;
- escaped defects and rollback rate;
- human interventions per low/medium/high-risk task;
- leaked preview resources and preview cost;
- average SAM task turns and repeated-context searches;
- test coverage of changed behavior, not only repository-wide coverage.

The practical first target is 80% of low-risk changes reaching a green,
live-verified PR without human intervention, with zero autonomous production
changes outside the allowlist.

## Remaining one-time owner actions

- Grant the automation identity GitHub repository Administration write
  permission or apply `.github/rulesets/main.json` in repository settings.
- Configure the production environment reviewer (the API requires a deliberate
  user/team choice) and prevent self-review.
- Disconnect the legacy `ttv-website` Vercel project from GitHub. The connected
  Vercel app is read-only here and no `VERCEL_TOKEN` is available, so deleting
  or mutating that external project would be unsafe to fake.
- After the branch reaches staging, have an admin mint the first bearer session
  and store it as the `STAGING_AGENT_TOKEN` secret on the GitHub `staging`
  environment.
- Approve a low-risk auto-merge allowlist and evidence retention window after
  observing the scheduled jobs and several agent-delivered pull requests.
