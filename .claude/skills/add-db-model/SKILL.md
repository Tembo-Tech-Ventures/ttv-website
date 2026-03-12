---
name: add-db-model
description: Add a new Prisma database model with migration
argument-hint: <ModelName>
disable-model-invocation: true
---

Add a new database model `$ARGUMENTS`. Follow these steps:

1. Read `web/prisma/schema.prisma` to understand existing patterns
2. Add the new model following existing conventions:
   - Use `@id @default(cuid())` for primary keys
   - Add `createdAt DateTime @default(now())` and `updatedAt DateTime @updatedAt` timestamps
   - Use `@relation(onDelete: Cascade)` for foreign keys that should cascade delete
   - Add appropriate `@@map()` for table naming if needed
3. Run `cd web && npx prisma migrate dev --name add-<model-name>`
4. Verify the Prisma client was regenerated with `cd web && npx prisma generate`
5. If needed, create a module at `web/src/modules/<feature>/` with `lib/` for data access functions
