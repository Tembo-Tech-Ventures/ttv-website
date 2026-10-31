import { createCapabilityDatabase } from "@/lib/platform/server/capabilities.test-support";
import type { CapabilityCase } from "@/lib/platform/server/capabilities.fixtures";
import { readMigration } from "@/test/sqlite-d1";
import type { SQLInputValue } from "node:sqlite";

export function attentionDatabase(fixture: Partial<CapabilityCase> = {}) {
  const setup = createCapabilityDatabase(fixture);
  // Real D1 raw() preserves duplicate column names in joins. Object.values(all())
  // loses those columns, so use SQLite's native array result mode here.
  const prepare = setup.db.$client.prepare.bind(setup.db.$client);
  setup.db.$client.prepare = (query: string) => {
    const statement = prepare(query);
    const bind = statement.bind.bind(statement);
    statement.bind = (...values: unknown[]) => {
      const bound = bind(...values);
      return Object.assign(bound, { async raw() {
        const native = setup.database.prepare(query);
        native.setReturnArrays(true);
        return native.all(...values as SQLInputValue[]);
      } });
    };
    return statement;
  };
  setup.database.exec(readMigration("0021_feature_flags.sql"));
  setup.database.exec(readMigration("0023_attention_items.sql"));
  function seed(id: string, options: { userId?: string; createdAt?: number; readAt?: number | null; space?: string; category?: string } = {}) {
    setup.database.prepare(`INSERT INTO attention_item
      (id,userId,eventKey,kind,space,category,subjectKind,subjectId,subjectHref,subjectLabel,summary,createdAt,readAt)
      VALUES (?,?,?,'application_status',?,?,'application',?,'/dashboard/apply','Application','Application updated',?,?)`)
      .run(id, options.userId ?? "synthetic-wanjiku", id, options.space ?? "cohort", options.category ?? "updates", id,
        options.createdAt ?? 1000, options.readAt ?? null);
  }
  return { ...setup, seed };
}
