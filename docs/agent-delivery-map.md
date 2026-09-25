# Agent delivery map

Four different things are called an “environment” in this delivery system. They
are related, but they are not interchangeable.

| Environment | What it is | What it contains |
| --- | --- | --- |
| SAM workspace | An ephemeral development VM for one task | Checkout, tools, tests, automatic SAM/GitHub task variables, and profile-scoped variables |
| SAM agent profile | Reusable configuration for a role | Model, permissions, prompt, VM settings, and optional encrypted runtime variables |
| GitHub environment | A GitHub Actions policy and secret scope | Deployment approvals, variables, and encrypted secrets; it does not run the application |
| Cloudflare environment | The live application stack | Worker, D1, R2, Queue, Vectorize, AI Gateway, Container binding, URL, and runtime logs |

SAM orchestrates the work. Cloudflare runs the application. GitHub Actions is a
credential broker and verification runner when a SAM workspace does not have
direct Cloudflare authority.

## The two preview paths

### Direct from SAM

    SAM implementer profile
      -> checked-out task branch
      -> preview-only Cloudflare credentials from profile secrets
      -> npm run cf:agent -- deploy
      -> agent-<task> Cloudflare stack
      -> seeded identity in that stack's D1
      -> Playwright plus npm run cf:agent -- tail
      -> npm run cf:agent -- destroy

This is the fastest iteration loop. It requires these profile variables:

- `CLOUDFLARE_ACCOUNT_ID`
- `CLOUDFLARE_API_TOKEN`
- `AGENT_PREVIEW_SECRET`
- optionally `CLOUDFLARE_WORKERS_SUBDOMAIN`

The deploy wrapper supplies the agent-only feature flag, clears custom domains,
uses disabled OAuth placeholders, derives a unique Better Auth secret, and
seeds an eight-hour admin identity in the isolated D1. It never needs the real
GitHub OAuth, shared staging, production Better Auth, or AI Gateway bearer
secrets.

Cloudflare edit permissions are account-scoped, not resource-name-scoped. A
token for the production Cloudflare account cannot be made technically incapable
of editing production merely by naming resources `agent-*`. The production-proof
direct path therefore uses a separate low-cost Cloudflare preview account. Until
that account exists, keep the production-account token out of SAM and use the
brokered path.

### Brokered through GitHub Actions

    SAM agent
      -> pushes its exact task branch
      -> dispatches Cloudflare Agent Environment on that ref
      -> GitHub staging environment releases Cloudflare/preview secrets
      -> agent-<task> Cloudflare stack
      -> seeded identity in that stack's D1
      -> health, desktop/mobile Playwright, and Worker tail evidence
      -> explicit destroy dispatch or stale-resource sweep

GitHub’s `staging` environment is a secret and approval boundary in this path;
it is not the deployed `staging` application. The workflow still targets an
isolated `agent-*` stack. Pull requests use `agent-pr-<number>` automatically
and destroy it when the PR closes. A daily cleanup backstop deletes isolated
stacks older than 72 hours when close-triggered or explicit teardown was missed.
It queries open pull requests first and excludes their preview names
automatically; manual cleanup runs remain dry-run-first.

## The production merge path

Main is production. Merging a pull request starts the `Cloudflare Production`
workflow, whose concurrency group has `cancel-in-progress: false`. Never
cancel, re-run, pause, or manually dispatch that workflow. Cancelling is not a
safety tool: a Worker deploy can finish before smoke and browser verification,
which is how the 2026-09-21 run left a new version live without verification.

The reusable deploy job runs the Astro typecheck, captures the active Worker
version and current `/api/health` revision, deploys, then runs exact-revision
smoke plus desktop/mobile Playwright. A failed production verification rolls
the Worker back to the captured version, smoke-checks the previously served
revision, and fails the job with a summary. The same reusable workflow serves
previews, but rollback conditions require the exact `production` environment;
an `agent-*` stack is never rolled back.

The rollback changes the active Worker version, including its code, assets,
bindings, compatibility settings, and Durable Object class code. It does not
rewind D1 or Durable Object data, queue state, R2 objects, or the FFmpeg
Container image/configuration rollout. Cloudflare also blocks rollback across
incompatible Durable Object lifecycle changes or missing bound resources.
Deployment and migration changes must remain backward compatible with the
previous Worker version.

After any production job failure, the final step posts the shared mission alert
payload to SAM through `web/scripts/cloudflare/notify-sam.mjs`. The GitHub
`production` environment owns `SAM_ALERT_WEBHOOK_URL` as a variable and
`SAM_ALERT_WEBHOOK_TOKEN` as a secret. If either is absent, the step emits a
notice and skips delivery. The payload links the Actions run and uses a stable
`deploy.failed:<run_id>:<run_attempt>` idempotency key; rollback command or
rollback verification failures use `kind: rollback.failed`.

## Authentication secrets

| Secret | Stored in | Valid against | Purpose |
| --- | --- | --- | --- |
| `AGENT_PREVIEW_SECRET` | GitHub `staging` environment and authorized SAM profiles | No database directly | Derives a different bearer token and Better Auth secret for each isolated `agent-*` D1 |
| `STAGING_AGENT_TOKEN` | GitHub `staging` environment only | Shared staging D1 only | Optional authenticated checks of the persistent shared staging application |
| `TTV_PERSONAL_ACCESS_TOKEN` | An authorized SAM profile's encrypted runtime variables | The TTV environment where an admin issued it | Expiring, revocable browser and API verification as the issuing user |
| Production auth secrets | GitHub `production` environment only | Production | Real application auth; never supplied to previews or SAM implementers |
| `SAM_ALERT_WEBHOOK_URL` | GitHub `production` environment variable | SAM webhook ingest endpoint | Destination for Worker, production deploy, and rollback alerts; delivery is disabled when absent |
| `SAM_ALERT_WEBHOOK_TOKEN` | GitHub `production` environment secret | SAM webhook trigger | Bearer credential for Worker and GitHub Actions alert delivery; never supplied to previews or logged |

Shared staging and production retain the repository's existing deterministic
Better Auth fallback when an explicit `BETTER_AUTH_SECRET` is absent, avoiding
an unplanned session-key rotation. An owner can migrate each shared environment
to an explicit stable secret during a deliberate sign-out window.

An admin creates `STAGING_AGENT_TOKEN` at `/admin/agent-access` while signed in
with a normal browser cookie. Bearer-authenticated sessions cannot access that
credential-management page, so a token cannot extend its own lifetime.

An admin can create a personal access token at
`/admin/personal-access-tokens`. Store the one-time value as the encrypted
`TTV_PERSONAL_ACCESS_TOKEN` profile variable; never paste it into a task,
message, command argument, log, screenshot, or knowledge entry. The live
Playwright wrapper reads that variable without printing it. Set
`RECORDING_SMOKE_ID` to inspect a particular recording during the authenticated
desktop/mobile smoke suite. Personal access tokens are user-bound, hashed in
D1, expiring, revocable, and either read-only or read/write. A delegated bearer
session or another personal access token cannot mint one.

`AGENT_PREVIEW_SECRET` is not inserted into D1. The deployer derives a
per-environment token from it, stores only that token in the isolated database,
and refreshes its expiry on deploy. The Playwright wrapper independently derives
the same token without printing it.

## Logs and evidence

- Direct SAM runs use `npm run cf:agent -- tail`.
- GitHub-hosted previews start `wrangler tail` before Playwright and upload the
  tail output, traces, and failure screenshots as a run artifact.
- Generated Workers explicitly enable persistent Cloudflare observability. Agent
  previews sample every invocation; shared staging and production sample 10%.
- `/api/health` binds every result to the expected environment and Git revision,
  preventing an agent from verifying a stale or cross-wired deployment.

SAM deployment logs apply to SAM Compose deployments. TTV is not hosted on SAM
Compose, so those logs are not application runtime evidence.

## Diff tools

Use native Git for code review:

    git status -sb
    git diff --stat origin/main...HEAD
    git diff origin/main...HEAD
    git diff --check origin/main...HEAD

SAM’s `get_workspace_diff_summary` reports aggregate workspace bookkeeping:
commit count, changed paths, insertions/deletions, and untracked files since the
workspace was created. It is useful for task reporting and detecting forgotten
files, but it does not replace a normal Git diff.
