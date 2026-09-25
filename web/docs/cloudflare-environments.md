# Cloudflare environment automation

This branch deploys Astro to Cloudflare Workers using a generated Wrangler config so environments can be created and destroyed by GitHub Actions without checking fixed environment names into git.

## What the automation does

- Derives resource names from `CLOUDFLARE_ENVIRONMENT_NAME`
- Creates a D1 database if it does not exist
- Creates an R2 bucket if it does not exist
- Generates a Wrangler config for that environment
- Pushes Better Auth and GitHub OAuth secrets into Cloudflare
- Runs D1 migrations remotely
- Deploys the Worker
- Deletes the Worker, D1 database, and R2 bucket on destroy

## Naming convention

For an environment named `staging`, the automation creates:

- Worker: `ttv-website-staging`
- D1 database: `ttv-website-db-staging`
- R2 bucket: `ttv-website-files-staging`

Any arbitrary environment name is normalized to a lower-case slug and used the same way.

## GitHub Actions entrypoints

- Reusable workflow: `.github/workflows/cloudflare-environment.yml`
- Generic manual wrapper: `.github/workflows/cloudflare-manual.yml`
- Production deploy: `.github/workflows/cloudflare-production.yml`
- Staging wrapper: `.github/workflows/cloudflare-staging.yml`
- Staging PR deploy: `.github/workflows/cloudflare-staging-pr.yml`

## Required GitHub secrets

Set these in the GitHub `staging` environment:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `GH_CLIENT_ID`
- `GH_CLIENT_SECRET`

`BETTER_AUTH_SECRET` is optional. If it is not set, deploy derives a stable secret automatically from the Cloudflare account/token, environment name, app name, and `GH_CLIENT_SECRET`.

## Optional GitHub variables

Set these in the GitHub `staging` environment if you want to use them:

- `CLOUDFLARE_WORKERS_SUBDOMAIN`
- `STAGING_REDIRECT_DOMAIN`
- `STAGING_BETTER_AUTH_URL`

If `STAGING_BETTER_AUTH_URL` is unset, the staging workflow derives `BETTER_AUTH_URL` from `staging.tembotechventures.com`.

## Cloudflare token scope

The API token needs enough scope to manage the resources this workflow touches:

- Workers Scripts Write
- Workers Scripts Read
- D1 Write
- D1 Read
- Workers R2 Storage Write
- Workers R2 Storage Read

If you deploy custom domains on a zone, the token also needs the zone access required for Workers custom domains on that account.

## Domain behavior

Set a primary domain and an optional redirect domain in workflow inputs or GitHub variables.

- The primary domain is attached to the Worker as a custom domain.
- The redirect domain is also attached to the same Worker.
- Runtime middleware redirects the redirect domain to the primary domain with HTTP 301.

## Production target

The production workflow is preconfigured to use:

- environment: `production`
- primary domain: `tembotechventures.com`
- redirect domain: `www.tembotechventures.com`

Production deploys automatically on every push to `main` via
`.github/workflows/cloudflare-production.yml`. A merge is the production
release path. Agents do not manually dispatch, re-run, pause, or cancel that
workflow. Its concurrency group keeps `cancel-in-progress: false`: cancelling
is not a safety tool because the Worker may already be live while later
verification steps are still pending.

For each deploy, the reusable job:

1. Runs `npm run typecheck:astro` before any production mutation.
2. Captures the active Worker version with `wrangler deployments status` and
   the Git revision currently returned by `/api/health`.
3. Deploys, verifies the new revision with `cf:smoke`, and runs the desktop and
   mobile Playwright journeys while collecting Worker tail evidence.
4. If smoke, browser installation, or a browser journey fails, runs
   `wrangler rollback <captured-version-id> --name <worker>` and re-runs smoke
   with the previously served health revision.
5. Fails the job with the verification and rollback outcomes, then sends a
   `deploy.failed` alert to SAM. A rollback command or rollback smoke failure
   sends `rollback.failed` instead.

Rollback is production-only. The reusable job never rolls back `agent-*`,
staging, or other environments.

### What a Worker rollback restores

[Cloudflare Worker versions](https://developers.cloudflare.com/workers/versions-and-deployments/)
contain the bundled Worker code, static assets, bindings, and compatibility
settings. [`wrangler rollback`](https://developers.cloudflare.com/workers/versions-and-deployments/rollbacks/)
immediately creates a deployment that sends 100% of traffic to the captured
version, restoring that version of the Worker and its Durable Object class
code.

Connected resource state is not versioned. A rollback does not undo D1
migrations or data, R2 objects, queue messages, Durable Object storage, or a
Container image/configuration rollout started by `wrangler deploy`; Container
[rollouts are separate and non-transactional](https://developers.cloudflare.com/containers/configuration/rollouts/).
The restored Worker must therefore remain compatible with additive data
changes and with the active FFmpeg Container image. Cloudflare refuses a rollback
across an incompatible Durable Object class lifecycle change or when a bound
resource required by the target version no longer exists. Those cases surface
as `rollback.failed`; the pipeline does not attempt a different production
mutation.

### SAM failure notification

The GitHub `production` environment owns both values used by the final
`if: failure()` step:

- `SAM_ALERT_WEBHOOK_URL`: GitHub Actions variable containing the SAM ingest URL
- `SAM_ALERT_WEBHOOK_TOKEN`: GitHub secret containing the bearer token

When either value is absent, the step emits a GitHub Actions notice and exits
successfully. When configured, `web/scripts/cloudflare/notify-sam.mjs` posts
the shared mission alert payload with `source: github-actions`, the Actions run
URL, and `Idempotency-Key: deploy.failed:<run_id>:<run_attempt>`. Only HTTP 202
is accepted, and the script never includes the token in output or errors.

## Production deployment checklist

Before the first production deploy, complete the following:

1. Ensure the `tembotechventures.com` zone is managed by Cloudflare in the same account referenced by `CLOUDFLARE_ACCOUNT_ID`.
2. Remove any existing DNS records (e.g., CNAME to Vercel) for `tembotechventures.com` and `www.tembotechventures.com` that would conflict with Workers custom domains.
3. Create a `production` GitHub environment with the required secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `BETTER_AUTH_SECRET`
   - `GH_CLIENT_ID`
   - `GH_CLIENT_SECRET`
   - `SAM_ALERT_WEBHOOK_TOKEN` after the owner creates the SAM webhook trigger
4. Add `SAM_ALERT_WEBHOOK_URL` as a variable on the `production` GitHub
   environment after the owner creates the SAM webhook trigger.
5. Create a GitHub OAuth App for production with the callback URL:
   - `https://tembotechventures.com/api/auth/callback/github`
6. Optionally add a review/approval gate on the `production` GitHub environment
   for extra safety.
7. Merge to `main`; the workflow triggers automatically.

## What production deploy creates

For the `production` environment, the deploy script creates or reuses:

- Worker: `ttv-website-production`
- D1 database: `ttv-website-db-production`
- R2 bucket: `ttv-website-files-production`

The `www.tembotechventures.com` redirect domain is attached to the same Worker and returns HTTP 301 redirects to `tembotechventures.com`.

## Staging target

The staging workflow is preconfigured to use:

- environment: `staging`
- primary domain: `staging.tembotechventures.com`

Run `.github/workflows/cloudflare-staging.yml` with `action=deploy` after the required secrets are configured.
Pull requests targeting `main` also deploy automatically to staging via `.github/workflows/cloudflare-staging-pr.yml`.

## Staging deployment checklist

The exact file references for staging are:

- Reusable workflow: `.github/workflows/cloudflare-environment.yml`
- Staging wrapper: `.github/workflows/cloudflare-staging.yml`
- Deploy script: `web/scripts/cloudflare/deploy.mjs`
- Destroy script: `web/scripts/cloudflare/destroy.mjs`
- Redirect-domain middleware: `web/src/middleware.ts`

To deploy `staging.tembotechventures.com`, complete the following:

1. Ensure the `tembotechventures.com` zone is managed by Cloudflare in the same account referenced by `CLOUDFLARE_ACCOUNT_ID`.
2. Create the required GitHub repository secrets:
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `GH_CLIENT_ID`
   - `GH_CLIENT_SECRET`
   - optional: `BETTER_AUTH_SECRET`
3. Create a GitHub OAuth App for staging.
4. Set the OAuth callback URL to:
   - `https://staging.tembotechventures.com/api/auth/callback/github`
5. Optionally set these GitHub repository variables:
   - `STAGING_REDIRECT_DOMAIN`
   - `STAGING_BETTER_AUTH_URL`
   - `CLOUDFLARE_WORKERS_SUBDOMAIN`
6. Run the `Cloudflare Staging` workflow with `action=deploy`.

If `STAGING_BETTER_AUTH_URL` is unset, the workflow derives Better Auth's base URL from `https://staging.tembotechventures.com`.

## What staging deploy creates

For the `staging` environment, the deploy script creates or reuses:

- Worker: `ttv-website-staging`
- D1 database: `ttv-website-db-staging`
- R2 bucket: `ttv-website-files-staging`

The deploy script then:

- pushes Better Auth and GitHub OAuth secrets into Cloudflare
- runs remote D1 migrations
- deploys the Worker
- attaches `staging.tembotechventures.com` as a custom domain

If `STAGING_REDIRECT_DOMAIN` is set, that domain is attached to the same Worker and redirected to the primary domain with an HTTP 301 response.

## GitHub OAuth note

This code path uses GitHub OAuth client credentials in Better Auth, not a GitHub App.

That means you need:

- `GH_CLIENT_ID`
- `GH_CLIENT_SECRET`

and the OAuth callback URL registered in GitHub must match the deployed environment URL exactly.

## Recommended staging token scope

The Cloudflare token should have at least:

- `Workers Scripts Write`
- `Workers Scripts Read`
- `D1 Write`
- `D1 Read`
- `Workers R2 Storage Write`
- `Workers R2 Storage Read`

If the token also needs to create or manage the `staging.tembotechventures.com` custom domain on the zone, ensure it has the corresponding zone permissions required by Workers custom domains in your account.

## Destroy caveat for R2

Cloudflare only allows deleting an R2 bucket when it is empty. If the environment bucket contains uploaded files, destroy will stop at bucket deletion and surface that Cloudflare error clearly.
