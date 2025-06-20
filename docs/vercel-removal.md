# Analysis of Vercel Usage

This document explains how the current project is set up to work with Vercel and identifies the areas that will need attention when migrating fully to Docker Compose.

## Vercel Specific Files and Configuration

- `web/vercel.json` – This file is essentially empty and only includes the `$schema` line. It is meant to provide Vercel with a configuration schema. Removing this file will have no impact on a local Docker-based workflow.
- `.gitignore` – The `.gitignore` file inside the `web` directory includes `.vercel` to prevent the Vercel deployment configuration directory from being committed.
- API route handler (`web/src/app/api/v1/[[...route]]/route.ts`) – The Hono framework is used with the `hono/vercel` adapter to serve API routes in a Vercel serverless environment.

```ts
import { Hono } from "hono";
import { handle } from "hono/vercel";
...
export const GET = handle(app);
```

- `web/package.json` – Built using `next build` which works on Vercel or any Node environment. No direct Vercel dependencies are listed.

## Database

The project uses PostgreSQL with Prisma. The `.env` file suggests a local Postgres connection string:

```ini
POSTGRES_PRISMA_URL=postgresql://user:password@localhost:5432/database
```

However, the repository likely relies on a managed instance on Neon when deployed to Vercel. Neon is promoted by Vercel for serverless Postgres, but there is no direct reference to Neon in this repository. To fully decouple from Vercel you can:

1. Run Postgres locally using Docker Compose (already defined in `web/compose.yaml`).
2. Update any environment variables or secrets that point to a Neon-hosted database to instead point to the local container or another Postgres instance.

## Removing Vercel-Specific Code

1. **Remove `web/vercel.json`** – This file is unnecessary when deploying with Docker Compose or another container platform.
2. **Update API handlers** – Replace the `hono/vercel` adapter with a standard adapter such as `hono/nextjs` or an Express-style server if running outside of Vercel. Example:

```ts
import { handle } from "hono/nextjs"; // or create a custom Node handler
```

3. **Cleanup `.gitignore`** – Removing the `.vercel` ignore rule is optional. If there is no Vercel deployment folder left in the repo, it can be removed.
4. **Check environment variables** – Review `.env` and deployment configuration to ensure no references to Neon or other Vercel-managed resources remain.

## Summary

Aside from the small adapter usage and the configuration file, the project is largely vendor neutral. Transitioning fully to Docker Compose should mainly involve:

- Ensuring a local Postgres database is running (via `docker compose up -d`).
- Replacing the Vercel-specific Hono handler with a Node/Next.js friendly one.
- Removing leftover Vercel configuration files.
- Moving the compose file to the repository root (`compose.yaml`) so Defang and other tools can find it automatically.



## Next Steps: Migrating to Defang

The [Defang platform](https://defang.io) provides tooling to take an existing Docker Compose setup and deploy it to major cloud providers with minimal configuration. After removing the Vercel-specific pieces, you can follow the instructions in [docs/defang-transition.md](defang-transition.md) to bootstrap the Defang CLI, configure your cloud provider, and deploy from Docker Compose.

