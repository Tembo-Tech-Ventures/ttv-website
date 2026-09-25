import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

const migrationSql = readFileSync(
  new URL("./0011_broad_mariko_yashida.sql", import.meta.url),
  "utf8"
).replaceAll("--> statement-breakpoint", "");

describe("observability migration", () => {
  it("is additive and safe to apply more than once", () => {
    const database = new DatabaseSync(":memory:");

    database.exec(migrationSql);
    expect(() => database.exec(migrationSql)).not.toThrow();

    const tables = database
      .prepare(
        `SELECT name FROM sqlite_master
         WHERE type = 'table' AND name IN ('errorEvent', 'platformAlert')
         ORDER BY name`
      )
      .all();
    expect(tables).toEqual([{ name: "errorEvent" }, { name: "platformAlert" }]);
    database.close();
  });

  it("enforces signatures, redacted-message length, and delivery attempts", () => {
    const database = new DatabaseSync(":memory:");
    database.exec(migrationSql);

    const insertError = database.prepare(
      `INSERT INTO "errorEvent"
       ("id", "signature", "source", "route", "message", "lastVersion")
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    insertError.run("error-1", "signature-1", "request", "/api/test", "safe", "v1");
    expect(() =>
      insertError.run("error-2", "signature-1", "request", "/api/test", "safe", "v1")
    ).toThrow(/UNIQUE constraint failed/);
    expect(() =>
      insertError.run(
        "error-3",
        "signature-3",
        "request",
        "/api/test",
        "x".repeat(501),
        "v1"
      )
    ).toThrow(/CHECK constraint failed/);

    const insertAlert = database.prepare(
      `INSERT INTO "platformAlert"
       ("id", "kind", "subject", "idempotencyKey", "payload", "attempts")
       VALUES (?, ?, ?, ?, '{}', ?)`
    );
    insertAlert.run("alert-1", "error.new", "signature-1", "key-1", 5);
    expect(() =>
      insertAlert.run("alert-2", "error.new", "signature-2", "key-2", 6)
    ).toThrow(/CHECK constraint failed/);
    database.close();
  });
});
