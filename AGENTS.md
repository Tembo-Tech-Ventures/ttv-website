# AGENTS: TTV Website Code Guidelines

This file documents how we expect code to be structured inside the Next.js app under `web/`. The guiding principle is **one exported function per file** and, as often as possible, **one functional file per directory** so the function can be colocated with its tests, assets, and helpers.

## Agent workspace
- Use `.agents/logs` to record work-in-progress notes: what you tried, what worked/failed, commands run, files touched, and follow-ups. Prefer appending to an existing log for the day/task.
- Use `.agents/tasks` to plan multi-step efforts. Create a file per task with goal, constraints, checklist/plan, decisions, and links to related logs/PRs.
- Keep the logs and tasks up to date as you work; these are the shared memory between agents.

## Tooling
- Devcontainer installs `@openai/codex` and seeds MCP config at `/home/node/.config/codex/config.toml` (servers: `context7`, `playwright`). Update the config if you add/remove servers.
- Use docker compose for repeatable envs (run from repo root): `docker compose -f compose.yaml up -d` for dev; `docker compose -f compose.test.yaml run --rm test-runner` for isolated tests. Helper scripts: `./scripts/dev-up.sh`, `./scripts/dev-down.sh`, `./scripts/test-run.sh`, `./scripts/test-down.sh`.

## Layout
- Primary app lives in `web/` with source in `web/src/`.
- `src/app` — Next.js app router. Route groups (e.g., `(admin)`, `(dashboard)`, `(public)`, `(certificate)`, `auth`, `blog`, `api`) hold their own `layout.tsx`, `page.tsx`, `components`, `lib`, `actions`, `hooks`, `atoms`, etc.
- `src/components` — shared UI primitives. Each subfolder contains a single component file named after the folder (e.g., `card/card.tsx`).
- `src/modules` — domain and infrastructure code (auth, roles, blog, analytics, mui, prisma, api, s3). Use `lib`, `components`, or `hooks` subfolders to group related pieces.
- `src/providers` — app-wide providers.
- `src/assets` — brand assets; keep components that render assets here.
- `src/types` — global/shared typings.

## Export and colocation rules
- Each implementation file should export **one** named thing (function, component, hook, or constant set). If a feature grows, create a deeper folder with a new file rather than adding multiple exports.
- Default exports are only for Next-required surfaces (`page.tsx`, `layout.tsx`, `error.tsx`, etc.). Everything else is a named export.
- Directory names mirror the main file name: `components/foo/foo.tsx`, `lib/get-posts/get-posts.ts`, `actions/toggle-role.ts`.
- Do not add barrel files/index files; import directly from the file.
- Colocate tests and support files: `feature/feature.ts`, `feature/feature.test.ts`, `feature/feature.mdx`/assets as needed.

## App router patterns
- Components are server by default. Add `"use client"` only when React state/effects or browser APIs are used (see `page-tracker.tsx`, form components).
- Server actions live under `actions/` in the relevant route group. Start with `"use server"`, keep them thin, perform permission checks (`checkAdminPermissions`), delegate persistence to `src/modules`, and call `revalidatePath` after mutations.
- API route handlers (`app/api/...`) export HTTP method functions. `api/v1` uses Hono; add new routes by creating a folder under `src/app/api/v1/[[...route]]/` with a single handler file exporting a `Hono` instance.

## Modules (shared/domain)
- Cross-route logic belongs in `src/modules/<domain>/lib/<feature>/<feature>.ts`. Keep data access in modules, not inside pages/components.
- Use the shared Prisma client from `@/modules/prisma/lib/prisma-client/prisma-client` (Prisma 7 + `@prisma/adapter-pg`). `DATABASE_URL` must be set; do not instantiate new clients.
- Prisma configuration lives in `web/prisma.config.ts` (datasource URL, migrations path). The schema no longer contains `datasource.url`.
- Auth/session helpers live in `@/modules/auth/...` (`getServerSession`). Role checks use `@/modules/roles/lib/check-admin-permissions` or `is-admin`.
- The typed API client is `@/modules/api/client` via Hono.

## Styling
- MUI is the design system. Prefer `sx` props over inline styles; lean on theme tokens.
- Use shared theme helpers: colors and shadows from `@/modules/mui/theme/constants` (`customColors`, `getShadow`), fonts from `@/modules/mui/theme/fonts`, theme from `@/modules/mui/theme/theme`.
- Reuse shared surfaces (`src/components/card/card.tsx`, `src/components/link/link.tsx`) before rolling new primitives.

## Typing and code style
- TypeScript `strict` is on. Add explicit return types for exported functions/hooks when not obvious.
- Use `@/` path aliases instead of deep relative paths.
- Import order: built-ins/third-party → `@/...` → relative; group with blank lines.
- Strings use double quotes; rely on ESLint/Prettier defaults for formatting.
- Keep components/functions small and single-purpose; extract new folders/files rather than accreting helpers.

## Testing and verification
- Run relevant checks for every change (lint, unit, integration). Note what you ran and the outcomes in `.agents/logs`.
- Jest + jsdom are configured (`web/jest.config.ts`, `web/jest.setup.ts`). Coverage is collected by default.
- Place tests next to their subject as `<name>.test.ts`. See `src/modules/roles/lib/is-admin/is-admin.test.ts` for mocking patterns.
- Prefer unit tests for pure functions and server actions; integration/UI tests use Testing Library when needed.
- Docker compose helpers: `docker compose -f compose.yaml up -d` for dev stack; `docker compose -f compose.test.yaml run --rm test-runner` (cleanup with `./scripts/test-down.sh`) for the isolated test stack.

## Documentation habits
- Many files begin with a short block comment describing the file’s role and any implementation notes (e.g., `blog/page.tsx`, `create-post.ts`). Follow that pattern for new server actions, pages, and API handlers.
- Comments should explain intent, not restate code. Keep them concise and high-signal.
