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
- Proper auth checks (`getServerSession()`, `checkAdminPermissions()`) on protected routes
- Input validation with Zod on all API endpoints

**Correctness**
- Proper error handling
- Correct TypeScript types (no `any` unless justified)
- Server vs client component boundaries respected
- `revalidatePath()` called after mutations in API routes

**Code Quality**
- Follows module structure: `src/modules/<feature>/lib/<function>/index.ts`
- Uses `@/` path aliases, not relative imports for cross-module references
- Tests exist for new logic
- No unused imports or dead code

**Performance**
- No unnecessary client components (prefer server components)
- Database queries are efficient (check for N+1)
- Proper use of Next.js caching patterns

Report findings organized by severity (critical, warning, suggestion).
