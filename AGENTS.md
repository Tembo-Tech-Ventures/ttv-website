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

Agents with a scoped Cloudflare token and the required OAuth configuration can
create a task-isolated environment. The command derives an `agent-*` name from
`SAM_TASK_ID`, refuses staging/production names, clears custom domains, deploys
the current commit, and verifies deployment identity plus the homepage:

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

The app currently has browser GitHub OAuth only. A prior bearer-token experiment
was not merged, so do not claim authenticated staging verification until a
staging-only agent auth flow is implemented and tested. Keep any future agent
credential feature disabled in production by default, scoped, revocable,
expiring, and auditable.

Current SAM project configuration may not supply `GH_TOKEN` or Cloudflare
credentials to every profile. Check credential presence before planning a push,
PR, or live deploy. Missing authority is a blocker to report, not permission to
reuse production credentials.

## Handoff

Before handing work back:

1. Review `git diff` and SAM `get_workspace_diff_summary`.
2. Run the complete verification suite and any live smoke/E2E checks.
3. Confirm task environments are destroyed or document why they remain.
4. Push the assigned output branch and check GitHub CI when credentials allow.
5. Report the exact tests, deployment URL/environment, observed logs, remaining
   risks, and any work requiring human action.
