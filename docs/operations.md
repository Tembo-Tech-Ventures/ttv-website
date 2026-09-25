# Operations: how TTV is monitored, deployed and automated

This is the runbook for the automation around the application. It records
the operating model agreed on 2026-09-25 (SAM idea "Operating model v2",
`01M3BCW1D71Z0HG0YEW0FGA7EP`), which trigger does what, how alerts flow, and
the actions only a human can take. Read it before touching triggers, the
production workflow, monitoring code or the alert contract.

## The model in one paragraph

Main is production. A merge deploys, the pipeline verifies (health identity,
smoke, desktop and mobile Playwright, Worker tail) and, once T2 lands, rolls
back on failure and tells SAM. Agents deliver through pull requests they merge
themselves, or open nothing. A daily read-only monitor pulls the signals the
app cannot report about itself; the app pushes its own failures to SAM within
fifteen minutes once the alert webhook exists. Reports go to the SAM library,
fixes go through implementation tasks, and nothing lands on main without the
full gate.

## Production policy

1. Merging to main deploys production automatically through the
   `Cloudflare Production` workflow. That is the intended, and only,
   production path for every agent, including scheduled maintenance.
2. Never cancel, re-run, pause or manually dispatch that workflow. On
   2026-09-21 a cancel landed the deploy step and skipped verification
   (run 35568039482); on 2026-09-14 a cancel left production stale for two
   days (run 34813497100).
3. Never run `wrangler`, the Cloudflare API or the repository `cf:*` scripts
   against `production`, `prod` or `staging` resources, and never edit
   production or GitHub environment secrets. Read-only diagnostics are fine:
   `/api/health`, the Workers observability query API, `SELECT` on D1.
4. After merging, wait for the production run, confirm
   `https://tembotechventures.com/api/health` reports your merge commit, and
   report the run URL. If the run fails or rolls back, report it and dispatch
   a follow-up task; do not intervene by hand.
5. Manual production actions (redeploy, rollback, destroy) go through the
   `ttv-release` skill with explicit human authorization in the task.
6. A human gate, if wanted, is a required reviewer on the GitHub `production`
   environment. It is not something to encode in agent prompts.

## Landing contract for every agent

Work ends in exactly one of three states:

| State | Meaning |
| --- | --- |
| MERGED | Test, lint, typecheck, audit, CI and the `preview / cloudflare-with-environment` check are green and the agent merged its own PR. |
| NOTHING OPENED | The agent was not confident enough to merge, so it opened nothing and said why. An empty run is a good run. |
| BLOCKED ON A NAMED HUMAN ACTION | The one thing only a human can do is the first line of the PR description, with what was already verified. "Please review" is not a named action. |

Scope each PR to one job, check for an open PR already doing that job, and
rebase on main before merging when shared files changed.

## SAM automation inventory

| Trigger | Source | Schedule (UTC) | Profile / skill | Purpose |
| --- | --- | --- | --- | --- |
| TTV daily platform health | cron | 05:30 daily | TTV Monitor / ttv-platform-health | Read-only health, delivery and community check; Monday adds the weekly report |
| TTV weekly dependency and security maintenance | cron | Monday 06:00 | TTV Maintenance / ttv-maintenance | Compatible upgrades and advisories, self-merged; no cleanup duty |
| TTV stale agent environment cleanup | cron | paused | TTV Maintenance / ttv-maintenance | Redundant: the GitHub `Cloudflare Agent Environment Cleanup` schedule executes daily |
| TTV weekly content and link health | cron | disabled | TTV Maintenance / ttv-maintenance | Folded into the daily monitor |
| TTV production alert triage | webhook | on alert | TTV Monitor / ttv-platform-health | Owner creates it in the SAM Triggers UI (see Owner actions) |
| TTV intake from GitHub issues | github `issues` labelled `sam` | on label | TTV Planner / ttv-plan-feature | Owner creates it in the SAM Triggers UI |

Profiles: TTV Planner, TTV Implementer, TTV Content Maintainer, TTV Independent
Reviewer, TTV Release Operator, TTV Maintenance, TTV Monitor. Skills:
ttv-plan-feature, ttv-feature-delivery, ttv-content-update,
ttv-independent-review, ttv-release, ttv-maintenance, ttv-platform-health.
Multi-task features run inside a SAM mission with published state entries
(decisions, contracts, file ownership, risks) so a replacement agent never
has to replay a long session.

Repository-owned automation that needs no SAM agent: `ci.yml` on every PR and
push; `cloudflare-staging-pr.yml` deploys `agent-pr-<n>` per PR and destroys
it on close; `cloudflare-production.yml` on push to main;
`cloudflare-sweep.yml` deletes `agent-*` stacks older than 72 hours daily.

## Monitoring

### Pull: the daily monitor

`ttv-platform-health` is read-only. It checks, in order: deployment identity
(`/api/health` version versus main HEAD, allowing a 30-minute deploy window),
public pages with content markers and timing, Workers Logs for the last 24
hours through the observability query API, D1 read-only state (failed or
stuck recordings, import source errors, the error ledger, stale contact
notes, pending client projects, seven-day product counts), GitHub delivery
(failed or cancelled runs, PRs older than three days, new issues), leaked
`agent-*` Workers, and, when a personal access token is configured,
authenticated dashboard and admin pages. On Mondays it adds the weekly
product and community report.

Outcomes per finding: GREEN (report only), DEFECT (dispatch at most two
`ttv-feature-delivery` tasks with evidence, after `search_tasks` and
`search_ideas`), OWNER (one `request_human_input`), NOISE (an idea titled
`monitor-noise: <signature>` that future runs respect). Reports live in the
SAM library at `/reports/platform-health/<date>.md`.

### Push: the app reports itself

Once T1 of wave 1 lands, the Worker records failures in an `errorEvent`
ledger (request, queue, cron, import and pipeline sources; redacted,
deduplicated per signature, bounded), exposes `checks`, `degraded` and
`alerts` on `/api/health`, and every fifteen minutes posts new or spiking
signatures, failed recordings, import errors and degraded transitions to the
SAM webhook. GitHub Actions posts `deploy.failed` and `rollback.failed` from
the production workflow (T2). Both stay silent until the owner creates the
webhook trigger and stores its URL and token.

### Alert payload contract

Headers: `Authorization: Bearer <sam_wh_…>`, `Content-Type: application/json`,
`Idempotency-Key: <kind>:<signature or run id>:<yyyy-mm-dd>`.

```json
{
  "source": "ttv-website | github-actions",
  "kind": "error.new | error.spike | recording.failed | import.error | health.degraded | deploy.failed | rollback.failed",
  "environment": "production",
  "version": "<git sha>",
  "signature": "<sha256 prefix>",
  "count": 12,
  "message": "<redacted, at most 500 characters>",
  "firstSeenAt": "ISO 8601",
  "lastSeenAt": "ISO 8601",
  "links": { "health": "https://tembotechventures.com/api/health", "run": "<actions run url>" }
}
```

Configuration names: `SAM_ALERT_WEBHOOK_URL` (GitHub Actions variable and
Worker plain-text variable) and `SAM_ALERT_WEBHOOK_TOKEN` (GitHub secret and
Worker secret), stored in the GitHub `production` environment only. Previews
and local development never receive them, so senders do nothing there.
HTTP 202 means delivered; anything else leaves the alert pending. The token
is never logged, printed or copied into a task, issue or knowledge entry.

### What the token in a SAM workspace can and cannot do

The project-level Cloudflare token can query Workers Logs, list Workers
scripts and settings, read the zone and run read-only D1 queries. It cannot
read zone analytics, notification policies, health checks or Web Analytics,
and it cannot build or deploy. Cloudflare notification webhooks need a Pro
zone and error-rate alerts are Enterprise-only, which is why alerting is
app-push plus agent-pull rather than Cloudflare notifications.

## Owner actions (one-time, human-only)

1. Create the SAM webhook trigger "TTV production alert triage" in
   Project → Triggers: profile TTV Monitor, skill ttv-platform-health, filter
   `kind` exists, concurrency 1, skip-if-running. Store the one-time token and
   the ingest URL in the GitHub `production` environment as
   `SAM_ALERT_WEBHOOK_TOKEN` (secret) and `SAM_ALERT_WEBHOOK_URL` (variable).
2. Create the GitHub trigger "TTV intake" (event `issues`, action `labeled`,
   label `sam`, ignore bots, profile TTV Planner, skill ttv-plan-feature).
3. Mint a read-only personal access token at `/admin/personal-access-tokens`
   and store it as `TTV_PERSONAL_ACCESS_TOKEN` on the TTV Monitor profile so
   the monitor can check authenticated pages. Rotate it when the monitor
   reports a 401.
4. Grant Zone Analytics Read to the SAM Cloudflare token, or enable Cloudflare
   Web Analytics and its weekly summary email, so traffic appears in the
   Monday report.
5. Enable Cloudflare Email Service and verify `tembotechventures.com` as a
   sending domain (Workers Paid: 3,000 sends a month included, then $0.35 per
   1,000). This unblocks the contact-note relay and the community digest.
6. Activate `.github/rulesets/main.json`, optionally add a required reviewer
   on the `production` environment, and delete the 2024 ClickUp repository
   webhook.
7. Decide the showcase questions listed in the idea (section 6.3) and whether
   to retire the shared `staging` stack, which has not deployed since
   2026-08-06 and is superseded by per-PR previews.

## Adding or changing automation

- New scheduled work: a cron trigger through the SAM MCP `create_trigger`
  tool, then `update_trigger` to attach a skill, `maxConcurrent: 1` and
  `skipIfRunning: true`. Put the runbook in the skill's system prompt, not in
  the trigger prompt, so it can be read back later.
- New event-driven work: a webhook or GitHub trigger, created in the SAM UI
  because the credential is shown once.
- Every automation change is recorded here, in the SAM knowledge graph and,
  when it affects behaviour, in a test.
- Scheduled and monitoring agents never patch. They report, dispatch and ask.

## Decision log

- 2026-09-25: production deploys only through the merge pipeline; agents never
  cancel the production workflow. Daily cleanup trigger paused, content trigger
  disabled, daily monitor created, prompts rewritten to the landing contract.
  Wave 1 dispatched: error ledger and alert push (T1), pipeline rollback and
  notification (T2), blog reader with RSS, sitemap and sharing metadata (T3),
  public front door (T4).
