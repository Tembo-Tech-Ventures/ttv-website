---
name: add-api-endpoint
description: Create a new API endpoint following project conventions
argument-hint: <endpoint-path>
disable-model-invocation: true
---

Create a new API endpoint at `$ARGUMENTS`. Follow these steps:

1. Create `web/src/pages/api/<path>.ts`

2. Export HTTP method handlers (`GET`, `POST`, `PUT`, `DELETE`) as named exports:
   ```typescript
   import type { APIRoute } from "astro";
   import { env } from "cloudflare:workers";
   import { drizzle } from "drizzle-orm/d1";
   import * as schema from "@/lib/db/schema";
   import { createAuth } from "@/lib/auth";

   export const POST: APIRoute = async ({ request }) => {
     const auth = createAuth(env);
     const session = await auth.api.getSession({ headers: request.headers });
     if (!session) {
       return new Response("Unauthorized", { status: 401 });
     }

     const db = drizzle(env.DB, { schema });
     // ... handle request
     return new Response(JSON.stringify({ success: true }), {
       headers: { "Content-Type": "application/json" },
     });
   };
   ```

3. For admin-only endpoints, check the ADMIN role:
   ```typescript
   const adminCheck = await env.DB
     .prepare(`SELECT ur.id FROM "UserRoles" ur JOIN "Roles" r ON ur."roleId" = r."id" WHERE ur."userId" = ? AND r."name" = 'ADMIN' LIMIT 1`)
     .bind(session.user.id)
     .first();
   if (!adminCheck) {
     return new Response("Forbidden", { status: 403 });
   }
   ```

4. Validate input with Zod before processing
5. Use parameterized queries (Drizzle ORM) — never interpolate user input into SQL
6. Run `cd web && npm run lint` — no lint errors
