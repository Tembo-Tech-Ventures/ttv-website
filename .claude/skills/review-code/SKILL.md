---
name: review-code
description: Review staged or recent code changes for quality, security, and correctness
argument-hint: [commit-range or file-path]
disable-model-invocation: true
---

Review the code changes. If `$ARGUMENTS` is provided, review that specific commit range or file. Otherwise, review staged changes (`git diff --cached`) or the most recent commit.

Check for:

**Security**
- SQL injection, XSS, command injection (OWASP top 10)
- Secrets or credentials in code
- Proper auth checks via middleware for `/dashboard/*` and `/admin/*` routes
- Input validation with Zod on API endpoints and form handlers
- CSRF considerations for form submissions

**Correctness**
- Proper error handling in form POST handlers
- Correct TypeScript types (no `any` unless justified)
- Astro server/client island boundaries respected (no hooks/event handlers in `.astro` files)
- Database queries use Drizzle's query builder or parameterized statements (never raw string interpolation)

**Code Quality**
- Uses `@/` path aliases, not relative imports for cross-module references
- Astro components preferred over React islands where possible
- Common components (`Button`, `Input`, `Table`, `Card`, `Badge`) used consistently
- Tests exist for new logic
- No unused imports or dead code

**Performance**
- No unnecessary React islands (prefer Astro components for static content)
- Database queries are efficient (check for N+1)
- `client:visible` preferred over `client:load` for below-the-fold content

Report findings organized by severity (critical, warning, suggestion).
