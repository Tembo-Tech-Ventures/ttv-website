---
name: add-db-model
description: Add a new Drizzle database model with D1 migration
argument-hint: <ModelName>
disable-model-invocation: true
---

Add a new database model `$ARGUMENTS`. Follow these steps:

1. Read `web/src/lib/db/schema.ts` to understand existing patterns

2. Add the new model following existing conventions:
   - Use the `cuid()` helper for primary keys (generates CUID2 IDs)
   - Spread `...timestamps` for `createdAt` and `updatedAt` fields
   - Use `.references(() => parentTable.id)` for foreign keys
   - Add `{ onDelete: "cascade" }` on references that should cascade delete
   - Use `text()` for strings, `integer()` for numbers, `integer({ mode: "timestamp" })` for dates
   - Use `text("col", { enum: ["A", "B"] })` for enum-like columns
   - Define relations with `relations()` from drizzle-orm

3. Example pattern:
   ```typescript
   export const myModel = sqliteTable("myModel", {
     id: cuid("id"),
     name: text("name").notNull(),
     parentId: text("parentId")
       .notNull()
       .references(() => parent.id, { onDelete: "cascade" }),
     ...timestamps,
   });

   export const myModelRelations = relations(myModel, ({ one }) => ({
     parent: one(parentTable, { fields: [myModel.parentId], references: [parentTable.id] }),
   }));
   ```

4. Generate the migration: `cd web && npm run db:generate`
   - This creates a SQL file in `src/lib/db/migrations/`

5. Apply locally: `cd web && npm run db:migrate:local`

6. Verify the migration SQL looks correct by reading the generated file
