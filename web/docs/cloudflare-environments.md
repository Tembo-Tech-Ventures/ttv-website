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

## Required GitHub secrets

Set these as repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`
- `BETTER_AUTH_SECRET`
- `GITHUB_CLIENT_ID`
- `GITHUB_CLIENT_SECRET`

## Optional GitHub variables

Set these as repository variables if you want to use them:

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

## Destroy caveat for R2

Cloudflare only allows deleting an R2 bucket when it is empty. If the environment bucket contains uploaded files, destroy will stop at bucket deletion and surface that Cloudflare error clearly.
