# TTV agent guide

This repository is an Astro 6 application deployed entirely on Cloudflare. The
app lives in `web/`; run Node commands from that directory.

## Start every SAM task

When `SAM_WORKSPACE_ID` is present, the workspace is ephemeral.

1. Call SAM `get_instructions` before inspecting or changing anything.
2. Switch to the exact output branch returned by that tool. Never work directly
   on `main`.
3. Use `list_project_agents`, `search_tasks`, and `search_messages` before
   changing shared deployment, schema, auth, or lock files.
4. Read the project knowledge and policies before architecture, content, or
   dependency decisions.
5. Run `npm ci --legacy-peer-deps` in `web/`, then establish a baseline with
   `npm test`, `npm run lint`, and `npm run typecheck`.
6. Report meaningful milestones with `update_task_status`.

Unpushed changes disappear when a SAM workspace is stopped. Commit and push
after each coherent, passing slice. Re-check CI after every push. If credentials
or the workspace network fail, report the environment issue instead of working
around security boundaries.

## Architecture and hotspots

- `web/src/pages`: Astro routes and APIs.
- `web/src/components`: Astro and React UI.
- `web/src/lib/db`: Drizzle schema and D1 migrations. Schema, migrations, and
  generated metadata must move together.
- `web/src/lib/recordings`: R2, Queue, Vectorize, AI Gateway, transcription, and
  FFmpeg pipeline logic.
- `web/src/lib/auth.ts` and `web/src/middleware.ts`: Better Auth and authorization.
- `web/scripts/cloudflare`: resource provisioning, deployment, smoke checks, and
  teardown.
- `web/wrangler.jsonc` and `web/worker-configuration.d.ts`: Cloudflare bindings.
- `.github/workflows`: pull-request staging, production deployment, and CI.

The most conflict-prone files are `web/package-lock.json`, the Drizzle schema and
migration journal, `web/worker-configuration.d.ts`, Cloudflare deployment
helpers, and shared workflows. Check other active agents before editing them.

Cloudflare is the only allowed runtime. Do not move workloads to SAM Compose
hosting or another compute provider. SAM should orchestrate the work; Cloudflare
should run the app. FFmpeg-class workloads belong in Cloudflare Containers.
AI inference must use Cloudflare AI Gateway unified mode with Gemma 4.

Cloudflare Container settings are billing controls, not harmless capacity knobs.
Keep FFmpeg container `max_instances` at 1 unless a human explicitly approves a
higher monthly cost. Keep the recording queue consumer `max_concurrency` at 1 so
pending videos drain progressively through the available container instead of
autoscaling concurrent Workers and containers. Any code path that starts or
health-checks a container must explicitly terminate it in a `finally` block,
using `destroy()` for one-shot FFmpeg work that does not need a warm process,
and the behavior needs a regression test in the same change. Before raising
container capacity or adding a new container health/smoke path, inspect live
Cloudflare Container usage and price the change from current Cloudflare
Container pricing.

## Definition of done

Every behavior change needs an automated test. Add the test in the same commit
as the implementation. At minimum, run:

```sh
cd web
npm test
npm run lint
npm run typecheck
```

Run focused tests while iterating, then the complete suite before handoff. Lint
warnings currently exist in older Astro pages; do not add new warnings. The
normal local Astro build may require a logged-in Cloudflare remote binding proxy
because AI and Vectorize do not have local emulation. Do not commit a workaround
that removes those bindings.

For UI work, verify desktop and mobile behavior. For auth, schema, migrations,
recording processing, or deployment code, add failure-path tests as well as the
happy path. Never declare a live deployment healthy from a successful deploy
command alone.

## Live Cloudflare iteration

Read `docs/agent-delivery-map.md` before changing preview credentials or
workflows. A SAM workspace, SAM profile, GitHub environment, and Cloudflare
environment are separate trust and runtime boundaries.

Agents with a preview-only Cloudflare token and `AGENT_PREVIEW_SECRET` can
create a task-isolated environment. The command derives an `agent-*` name from
`SAM_TASK_ID`, refuses staging/production and overlong names, clears custom
domains, seeds an expiring identity in the isolated D1, deploys the current
commit, and verifies deployment identity plus the homepage:

```sh
cd web
npm run cf:agent -- context
npm run cf:agent -- deploy
npm run cf:agent -- tail
npm run cf:agent -- destroy
```

Always destroy an agent environment after verification. The teardown removes the
Worker, D1 database, R2 bucket, Queue, Vectorize index, and AI Gateway. If R2 is
not empty, preserve the environment and report the cleanup blocker rather than
deleting user data.

Cloudflare account permissions cannot be restricted by an `agent-*` name
prefix. Direct SAM credentials should target a separate preview account. When an
agent workspace does not have those credentials or Docker, dispatch
the `Cloudflare Agent Environment` GitHub workflow on the exact output branch.
It uses GitHub's `staging` environment only as a credential boundary while
still creating a separate `agent-*` Cloudflare stack. The workflow validates
the prefix, deploys, checks deployment identity, runs desktop/mobile Playwright,
captures Worker tail logs, and uploads evidence. Dispatch the same environment
name with `action=destroy` after review.
Use the `Cloudflare Agent Environment Cleanup` workflow for dry-run-first stale
cleanup; never weaken its age, prefix, or active-task exclusion guards.

Use `npm run cf:smoke -- --base-url=https://...` for an existing deployment.
Supply `--expected-environment` and `--expected-version` whenever those values
are known so a shared or stale deployment cannot be mistaken for the current
change.

`npm run cf:agent -- tail` streams Cloudflare Worker logs. SAM deployment logs
apply only to SAM-hosted Compose environments and are not the source of truth for
this Cloudflare Workers application.

Do not deploy to `staging`, `production`, or a custom domain unless the human
explicitly asks. Production promotion stays behind repository review and the
GitHub production environment. Never add manual Cloudflare container registry
login; `wrangler deploy` handles the managed registry.

## Auth and agent limitations

Browser GitHub OAuth remains the normal user path. Staging and isolated
`agent-*` environments may additionally enable the official Better Auth bearer
plugin. An authenticated admin creates short-lived, revocable sessions at
`/admin/agent-access`; the raw token is shown once and session listings never
select it. The deployment generator rejects the feature for production and any
environment other than `staging` or `agent-*`.

Isolated previews and shared staging use different credentials because they use
different D1 databases:

- `AGENT_PREVIEW_SECRET` derives a unique eight-hour token inside each
  `agent-*` D1. Store it in GitHub's `staging` environment and only the SAM
  profiles authorized to deploy previews.
- `STAGING_AGENT_TOKEN` is minted by a cookie-authenticated admin and is valid
  only in the persistent shared staging D1. Store it only in GitHub's `staging`
  environment.

Bearer sessions cannot access `/admin/agent-access` and therefore cannot mint
or extend credentials. Never put either secret or a derived bearer token in a
command argument, log, issue, task message, commit, screenshot, or SAM knowledge
entry.

Current SAM project configuration may not supply `GH_TOKEN` or Cloudflare
credentials to every profile. Check credential presence before planning a push,
PR, or live deploy. Missing authority is a blocker to report, not permission to
reuse production credentials.

## Handoff

Before handing work back:

1. Use native `git diff` as the review source of truth. Use SAM
   `get_workspace_diff_summary` only as an aggregate bookkeeping check for
   forgotten or untracked workspace changes.
2. Run the complete verification suite and any live smoke/E2E checks.
3. Confirm task environments are destroyed or document why they remain.
4. Push the assigned output branch and check GitHub CI when credentials allow.
5. Report the exact tests, deployment URL/environment, observed logs, remaining
   risks, and any work requiring human action.
