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
