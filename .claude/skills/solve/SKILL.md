---
name: solve
description: End-to-end problem solving — analyse, plan, implement, test, review, and merge
argument-hint: <problem-description or issue-number>
disable-model-invocation: true
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
3. Check related tests, types, and database schema as needed.
4. If external context is needed (docs, APIs), fetch it.

## Phase 3: Document the Research

1. Write a brief summary of your findings directly in conversation — what exists today, what needs to change, and any constraints or risks discovered.

## Phase 4: Develop a Plan

1. Design a solution that follows existing project conventions (see CLAUDE.md and ARCHITECTURE.md).
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

## Phase 7: Review the Implementation

**Automated checks — all must pass:**

```bash
cd web && npm run lint
cd web && npm test
```

**Manual review — check for:**

- Security: auth guards, input validation, no secrets in code (OWASP top 10)
- Correctness: proper types, server/client boundaries, `revalidatePath()` after mutations
- Quality: module structure, `@/` imports, no dead code, tests cover new logic
- Performance: prefer server components, no N+1 queries, proper caching

Fix any issues found, commit, and push.

## Phase 8: Create a Pull Request

1. Create a feature branch if not already on one (branch off `main`).
2. Push the branch to remote with `git push -u origin <branch-name>`.
3. Create a PR with `gh pr create` including:
   - A concise title (under 70 characters)
   - A body with `## Summary` (bullet points of changes) and `## Test plan` (how to verify)
4. Share the PR URL.

## Phase 9: Review PR Checks

1. Wait briefly, then run `gh pr checks <pr-number>` to see CI status.
2. If any checks fail (lint, tests, third-party services), investigate the failure:
   - Run `gh run view <run-id> --log-failed` to read failure logs.
   - Fix the issue, commit, and push. Repeat until all checks are green.
3. Confirm all checks pass before proceeding.

## Phase 10: Merge the PR

1. Once all checks are green, merge with `gh pr merge <pr-number> --squash --delete-branch`.
2. Confirm the merge succeeded with `gh pr view <pr-number>`.

---

**Throughout all phases:**
- Commit and push regularly — never let more than one logical change go uncommitted.
- If blocked, explain the blocker and ask the user for guidance rather than guessing.
- Keep the user informed of progress at each phase transition.
