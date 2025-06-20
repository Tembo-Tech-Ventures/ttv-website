# Using Postgres with Defang

This guide summarizes how to configure Postgres when deploying with [Defang](https://defang.io).
It is based on the Defang documentation for [Managed Postgres](https://docs.defang.io/docs/concepts/managed-storage/managed-postgres).

## Managed Postgres via `compose.yaml`

Defang can provision and manage a production Postgres instance for you. To enable
this, annotate your database service in `compose.yaml` with the `x-defang-postgres`
extension. During local development the container runs normally, while in the
cloud Defang replaces it with a managed service.

```yaml
services:
  db:
    image: postgres:14
    x-defang-postgres: true
    ports:
      - mode: host
        target: 5432
    environment:
      POSTGRES_PASSWORD:        # injected by Defang
      POSTGRES_USER: postgres
      POSTGRES_DB: postgres
```

## Required configuration

Defang requires a database password to be configured separately from the compose
file. Set it using the CLI:

```bash
defang config set POSTGRES_PASSWORD <your-password>
```

If the password is missing, deployment will fail.

## Optional configuration

You may also set `POSTGRES_USER` and `POSTGRES_DB` environment variables to
control the user and database names. Defaults are `postgres` for both.

## Connecting to the database

Your services can connect to the managed database using the service name as the
hostname and the above credentials. Defang recommends using Postgres 14 images
for best compatibility.
