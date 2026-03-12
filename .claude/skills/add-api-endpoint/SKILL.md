---
name: add-api-endpoint
description: Scaffold a new Hono API endpoint following project conventions
argument-hint: <endpoint-path>
disable-model-invocation: true
---

Create a new API endpoint at `$ARGUMENTS`. Follow these steps:

1. Create a handler file at `web/src/app/api/v1/[[...route]]/<name>/<name>.ts`
2. Define a Hono router with:
   - Zod validation via `zValidator("json", zodSchema)` (use `.passthrough()` for dynamic form data)
   - Auth via `getServerSession()` — return 401 JSON if no session
   - Admin checks via `checkAdminPermissions()` if this is an admin-only route
   - Call `revalidatePath()` after mutations
3. Register the handler in `web/src/app/api/v1/[[...route]]/route.ts` with `.route("/path", handler)`
4. The `AppType` export is automatically updated — verify the frontend client type works
5. Write tests for the new endpoint
6. Run `cd web && npm test && npm run lint` — everything must pass
