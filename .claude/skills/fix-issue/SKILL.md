---
name: fix-issue
description: Fix a GitHub issue end-to-end
argument-hint: <issue-number>
disable-model-invocation: true
---

Fix GitHub issue #$ARGUMENTS. Follow these steps:

1. Run `gh issue view $ARGUMENTS` to understand the issue
2. Search the codebase for relevant files
3. Implement the fix following existing patterns in this codebase:
   - Astro pages in `src/pages/`, layouts in `src/layouts/`
   - React islands in `src/components/` (only when interactivity needed)
   - Database schema in `src/lib/db/schema.ts` (Drizzle ORM + SQLite/D1)
   - Auth via middleware (`src/middleware.ts`) using better-auth
   - Styling with Tailwind CSS and project theme variables
4. Write or update tests for the change
5. Run `cd web && npm test` — all tests must pass
6. Run `cd web && npm run lint` — no lint errors
7. Create a descriptive commit referencing the issue (e.g., "fix: description. Closes #$ARGUMENTS")
