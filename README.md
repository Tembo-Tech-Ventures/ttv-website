# The TTV Website

## Agent workflow
- Read `AGENTS.md` for structure/style rules (one-export-per-file, colocated assets/tests).
- Use `.agents/tasks` to plan multi-step work and `.agents/logs` to record commands, tests, and outcomes.

## Dev environment
- Devcontainer installs `@openai/codex` and seeds MCP config at `/home/node/.config/codex/config.toml` (context7, playwright servers).
- Local stack: `docker compose -f compose.yaml up -d` (Next.js dev + Postgres + Mailhog + S3 mock). Scripts: `./scripts/dev-up.sh`, `./scripts/dev-down.sh`.
- Test stack: `docker compose -f compose.test.yaml run --rm test-runner` (or `./scripts/test-run.sh`; cleanup with `./scripts/test-down.sh`).
- Prisma 7 uses `web/prisma.config.ts` for datasource config and `@prisma/adapter-pg` in the shared client. Ensure `DATABASE_URL` is set before generating or running tests.

## Testing
- From `web/`: `npm run lint` (eslint flat config) and `npm test` (Jest + Testing Library, see `web/jest.config.ts`).
- Document what you run in `.agents/logs` and add/extend tests for touched code.
