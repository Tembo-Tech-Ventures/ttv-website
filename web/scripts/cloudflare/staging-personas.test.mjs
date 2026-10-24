import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import { withStagingPersonas } from "./staging-personas.mjs";

function fixture() {
  const db = new DatabaseSync(":memory:");
  db.exec(`CREATE TABLE user (id TEXT PRIMARY KEY, name TEXT, email TEXT UNIQUE, emailVerified INTEGER, createdAt INTEGER, updatedAt INTEGER);
    CREATE TABLE Roles (id TEXT PRIMARY KEY, name TEXT UNIQUE);
    CREATE TABLE UserRoles (id TEXT PRIMARY KEY, userId TEXT, roleId TEXT, createdAt INTEGER, updatedAt INTEGER);
    CREATE TABLE session (id TEXT PRIMARY KEY, expiresAt INTEGER, token TEXT UNIQUE, userAgent TEXT, userId TEXT, createdAt INTEGER, updatedAt INTEGER);
    INSERT INTO Roles VALUES ('mentor', 'MENTOR'), ('institution', 'INSTITUTION');`);
  const executeQuery = vi.fn(async (_id, sql, params) => {
    const statement = db.prepare(sql);
    return [{ results: sql.startsWith("SELECT") ? statement.all(...params) : (statement.run(...params), []) }];
  });
  return { db, options: { environmentName: "staging", database: { uuid: "staging-db", name: "ttv-website-db-staging" }, executeQuery, now: new Date("2026-10-24T10:00:00Z") } };
}

describe("synthetic shared staging personas", () => {
  it("uses distinct nonadmin identities, one-hour tokens and revokes them after verification", async () => {
    const { db, options } = fixture();
    try {
      await expect(withStagingPersonas({ ...options, run: async (personas) => {
        expect(Object.keys(personas)).toHaveLength(5);
        expect(new Set(Object.values(personas).map(p => p.token)).size).toBe(5);
        expect(db.prepare("SELECT count(*) n FROM session").get().n).toBe(5);
        expect(db.prepare("SELECT roleId FROM UserRoles ORDER BY roleId").all().map(r => r.roleId)).toEqual(["institution", "mentor"]);
        for (const persona of Object.values(personas)) expect(persona.expiresAt).toBe(Date.parse("2026-10-24T11:00:00Z") / 1000);
        return "must not escape callback";
      } })).resolves.toBeUndefined();
      expect(db.prepare("SELECT count(*) n FROM session").get().n).toBe(0);
      expect(db.prepare("SELECT count(*) n FROM user").get().n).toBe(5);
    } finally { db.close(); }
  });

  it.each(["production", "prod", "agent-pr-172", ""])("rejects %s before SQL", async (environmentName) => {
    const executeQuery = vi.fn();
    await expect(withStagingPersonas({ environmentName, database: { uuid: "db", name: "ttv-website-db-staging" }, executeQuery, run: vi.fn() })).rejects.toThrow("exact shared staging database");
    expect(executeQuery).not.toHaveBeenCalled();
  });

  it("rejects a mismatched database even when environment says staging", async () => {
    await expect(withStagingPersonas({ environmentName: "staging", database: { uuid: "db", name: "ttv-website-db-production" } })).rejects.toThrow("exact shared staging database");
  });

  it("revokes sessions and sanitizes callback errors", async () => {
    const { db, options } = fixture();
    try {
      await expect(withStagingPersonas({ ...options, run: async (p) => { throw new Error(p.member.token); } })).rejects.toThrow("setup or verification failed");
      expect(db.prepare("SELECT count(*) n FROM session").get().n).toBe(0);
    } finally { db.close(); }
  });

  it("fails before user creation when role migrations are absent", async () => {
    const { db, options } = fixture();
    try {
      db.exec("DELETE FROM Roles");
      const run = vi.fn();
      await expect(withStagingPersonas({ ...options, run })).rejects.toThrow("setup or verification failed");
      expect(run).not.toHaveBeenCalled();
      expect(db.prepare("SELECT count(*) n FROM user").get().n).toBe(0);
    } finally { db.close(); }
  });

  it("cleans up partial setup without touching existing sessions", async () => {
    const { db, options } = fixture();
    try {
      db.exec("INSERT INTO session (id, userId, userAgent) VALUES ('existing', 'real-user', 'browser')");
      const executeQuery = vi.fn(async (id, sql, params) => {
        if (sql.startsWith('INSERT INTO "user"') && params[0].endsWith("-mentor")) {
          throw new Error("simulated interrupted setup");
        }
        return options.executeQuery(id, sql, params);
      });
      const run = vi.fn();
      await expect(withStagingPersonas({ ...options, executeQuery, run })).rejects.toThrow("setup or verification failed");
      expect(run).not.toHaveBeenCalled();
      expect(db.prepare("SELECT id FROM session").all().map(r => r.id)).toEqual(["existing"]);
    } finally { db.close(); }
  });

  it("reports failed revocation explicitly without exposing bindings", async () => {
    const { db, options } = fixture();
    try {
      const executeQuery = vi.fn(async (id, sql, params) => {
        if (sql.startsWith('DELETE FROM "session"')) throw new Error("unsafe provider body");
        return options.executeQuery(id, sql, params);
      });
      await expect(withStagingPersonas({ ...options, executeQuery, run: async () => {} })).rejects.toThrow("cleanup failed; sessions expire within one hour");
    } finally { db.close(); }
  });
});
