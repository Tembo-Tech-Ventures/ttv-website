# The TTV Website

## Agent workflow
- Read `AGENTS.md` for structure/style rules (one-export-per-file, colocated assets/tests).
- Use `.agents/tasks` to plan multi-step work and `.agents/logs` to record commands, tests, and outcomes.

## Dev environment
- Devcontainer installs `@openai/codex` and seeds MCP config at `/home/node/.config/codex/config.toml` (context7, playwright servers).
- Local stack: `docker compose -f compose.yaml up -d` (Next.js dev + Postgres + Mailhog + S3 mock). Scripts: `./scripts/dev-up.sh`, `./scripts/dev-down.sh`.
- Test stack: `docker compose -f compose.test.yaml run --rm test-runner` (or `./scripts/test-run.sh`; cleanup with `./scripts/test-down.sh`).

## Testing
- From `web/`: `npm run lint` and `npm test` (Jest + Testing Library, see `web/jest.config.ts`).
- Document what you run in `.agents/logs` and add/extend tests for touched code.
