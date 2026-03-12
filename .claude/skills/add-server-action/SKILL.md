---
name: add-server-action
description: Create a new server action following project conventions
argument-hint: <action-name>
disable-model-invocation: true
---

Create a new server action for `$ARGUMENTS`. Follow these steps:

1. Create or update an action file at `web/src/app/actions/<feature>.ts`
2. Mark the file with `"use server"` at the top
3. Export async functions with:
   - Auth via `getServerSession()` — throw if no session
   - Admin checks via `checkAdminPermissions()` if admin-only
   - Call `revalidatePath()` after mutations
4. Import and call the server action directly from the client component
5. Use `useSWRMutation` to wrap the call for loading/error state if needed
6. Write tests for the new action
7. Run `cd web && npm test && npm run lint` — everything must pass
