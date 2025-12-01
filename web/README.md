# TTV Web App

## Quickstart
- Install deps: `npm install`
- Run dev: `npm run dev` (or from repo root: `docker compose -f compose.yaml up -d` / `./scripts/dev-up.sh`)
- Run tests: `npm run test` (or from repo root: `docker compose -f compose.test.yaml run --rm test-runner` / `./scripts/test-run.sh`)
- Lint: `npm run lint`

## Services (compose)
- Root `compose.yaml` spins up Next.js dev server (`app`), Postgres (`db`), Mailhog (`mailer`), and S3 mock (`s3`). Use `docker compose -f ../compose.yaml ...` if running from this directory.
- Root `compose.test.yaml` runs Jest in a disposable container with isolated Postgres/Mailhog/S3. Use `docker compose -f ../compose.test.yaml ...` if running from this directory.
- Env vars in compose files mirror local defaults (`DATABASE_URL`, `S3_ENDPOINT`, `EMAIL_SERVER`, etc.).

## Testing expectations
- Every change should include relevant tests (unit for module logic, integration/UI via Testing Library).
- Jest setup lives in `jest.config.ts` and `jest.setup.ts`; CSS imports are mocked via `test/__mocks__/styleMock.js`.
- Document tests you ran (and results) in `.agents/logs`.

## Tooling
- Devcontainer installs `@openai/codex` and copies `.devcontainer/codex/config.toml` into the container for MCP servers (context7, playwright).
- Path aliases: `@/*` -> `src/*` (see `tsconfig.json`).
- Avoid barrel files; prefer one export per file and colocate tests/assets with their feature.
