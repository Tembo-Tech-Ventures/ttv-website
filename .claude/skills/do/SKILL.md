---
name: do
description: End-to-end problem solving — analyse, plan, implement, test, review, and merge
argument-hint: <problem-description or issue-number>
---

Solve `$ARGUMENTS` end-to-end. Follow every phase below in order. Commit and push to remote regularly throughout (at minimum after each major phase).

---

## Phase 1: Analyse the Problem

1. If `$ARGUMENTS` is a GitHub issue number, run `gh issue view $ARGUMENTS` to read it.
2. Restate the problem in your own words. Identify the root cause or desired outcome.
3. List what you already know and what you need to find out.

## Phase 2: Research Requirements

1. Search the codebase for all files, modules, and patterns relevant to the problem.
2. Read the relevant source files to understand current behaviour.
3. Check related tests, types, and database schema (`web/src/lib/db/schema.ts`) as needed.
4. If external context is needed (docs, APIs), fetch it.

## Phase 3: Document the Research

1. Write a brief summary of your findings directly in conversation — what exists today, what needs to change, and any constraints or risks discovered.

## Phase 4: Develop a Plan

1. Design a solution that follows existing project conventions (see CLAUDE.md).
2. List the files that will be created, modified, or deleted.
3. Note any migrations, environment variable changes, or dependency additions required.

## Phase 5: Break Down into Tasks

1. Use the TodoWrite tool to create a concrete, ordered task list.
2. Each task should be small enough to implement and verify independently.

## Phase 6: Implement

For each task:

1. Implement the change following project patterns.
2. Mark the task complete in the todo list.
3. Commit with a clear, descriptive message after each logical unit of work.
4. Push to remote (`git push`) after each commit.

All commands must be run from the `web/` directory.

## Phase 7: Visual & UI Testing (if UI was changed)

Skip this phase if the change is purely backend (no components, pages, or styles were touched).

### 7a: Set up Playwright (if not already installed)

1. Check if Playwright is installed: `ls web/node_modules/.bin/playwright 2>/dev/null`
2. If not installed, run from `web/`:
   ```bash
   npm install -D @playwright/test
   npx playwright install chromium
   ```
3. If `web/playwright.config.ts` does not exist, create it with:
   - `webServer` pointing to `npm run preview` on port 4321
   - `testDir` set to `e2e`
   - Three projects: `desktop-chrome` (viewport 1280x720), `mobile-portrait` (viewport 375x812), and `mobile-landscape` (viewport 812x375)
   - `use.screenshot: "on"` to capture screenshots on every test
   - `outputDir` set to `e2e/results`
   - Add `e2e/results/` to `.gitignore` if not already there

### 7b: Write visual UI tests

1. Create test files under `web/e2e/` for each changed page or component.
2. Each test file must:
   - Test with a **variety of mock data** — empty states, single items, many items, long text, special characters, and edge cases relevant to the UI.
   - Test on all three viewport projects (desktop, mobile portrait, mobile landscape) — Playwright projects handle this automatically.
   - **Take full-page screenshots** at key states using `await page.screenshot({ path: 'e2e/results/<descriptive-name>.png', fullPage: true })`.
   - **Check for horizontal overflow** on mobile viewports.
   - Verify key elements are **visible and not clipped**.
   - Verify interactive elements (buttons, links, form fields) are **tappable on mobile** (>= 44px tap target).

### 7c: Run the tests and review screenshots

1. Run Playwright tests: `cd web && npx playwright test`
2. If any test fails, fix the implementation (not the test) and re-run.
3. **Review every screenshot** using the Read tool to visually inspect them.
4. If any screenshot reveals a visual issue, fix the implementation and re-run until all screenshots look excellent.
5. Commit the test files (but NOT the screenshot results — they should be gitignored).
6. Push to remote.

## Phase 8: Review the Implementation

**Automated checks — all must pass:**

```bash
cd web && npm run lint
cd web && npm test
```

**Manual review — check for:**

- Security: auth guards in middleware, input validation, no secrets in code (OWASP top 10)
- Correctness: proper types, Astro server/client island boundaries, form handling
- Quality: `@/` imports, no dead code, tests cover new logic
- Performance: prefer Astro components over React islands, no N+1 queries

Fix any issues found, commit, and push.

## Phase 9: Create a Pull Request

1. Create a feature branch if not already on one (branch off `main`).
2. Push the branch to remote with `git push -u origin <branch-name>`.
3. Create a PR with `gh pr create` including:
   - A concise title (under 70 characters)
   - A body with `## Summary` (bullet points of changes) and `## Test plan` (how to verify)
4. Share the PR URL.

## Phase 10: Review PR Checks

1. Wait briefly, then run `gh pr checks <pr-number>` to see CI status.
2. If any checks fail, investigate with `gh run view <run-id> --log-failed`.
3. Fix the issue, commit, and push. Repeat until all checks are green.

## Phase 11: Merge the PR

1. Once all checks are green, merge with `gh pr merge <pr-number> --squash --delete-branch`.
2. Confirm the merge succeeded with `gh pr view <pr-number>`.

---

**Throughout all phases:**
- Commit and push regularly — never let more than one logical change go uncommitted.
- If blocked, explain the blocker and ask the user for guidance rather than guessing.
- Keep the user informed of progress at each phase transition.
