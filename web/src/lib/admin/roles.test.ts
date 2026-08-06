import { DatabaseSync } from "node:sqlite";
import { describe, expect, it, vi } from "vitest";
import type { SQL } from "drizzle-orm";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import { AGENT_SESSION_PREFIX } from "@/lib/agent-auth";
import type { Database } from "@/lib/db/schema";
import {
  AdminRoleOperationError,
  adminRoleErrorMessage,
  assertPersistentAdminRoleMutationAllowed,
  assignAdminRole,
  createDrizzleAdminRoleStore,
  revokeAdminRole,
  type AdminRoleStore,
} from "./roles";

function createStore({
  roleId = "admin-role",
  users = ["actor", "target"],
  admins = [],
}: {
  roleId?: string | null;
  users?: string[];
  admins?: string[];
} = {}) {
  const assignments = new Set(admins);
  const store: AdminRoleStore = {
    findRoleByName: vi.fn(async () =>
      roleId ? { id: roleId } : undefined
    ),
    userExists: vi.fn(async (userId) => users.includes(userId)),
    hasRole: vi.fn(async (userId) => assignments.has(userId)),
    grantRole: vi.fn(async (userId) => {
      const changed = !assignments.has(userId);
      assignments.add(userId);
      return changed;
    }),
    revokeRoleIfOtherAdminExists: vi.fn(async (userId) => {
      if (!assignments.has(userId)) return false;
      const hasOtherAdmin = [...assignments].some(
        (adminUserId) => adminUserId !== userId
      );
      if (!hasOtherAdmin) return false;
      assignments.delete(userId);
      return true;
    }),
  };
  return { store, assignments };
}
interface CapturedQuery {
  sql: string;
  params: unknown[];
}

function createExecutableRoleStore() {
  const database = new DatabaseSync(":memory:");
  database.exec(`
    CREATE TABLE "UserRoles" (
      "id" text PRIMARY KEY NOT NULL,
      "userId" text NOT NULL,
      "roleId" text NOT NULL
    );
    CREATE UNIQUE INDEX "UserRoles_userId_roleId_unique"
      ON "UserRoles" ("userId", "roleId");
  `);
  const dialect = new SQLiteSyncDialect();
  const captured: CapturedQuery[] = [];
  const run = vi.fn(async (statement: SQL) => {
    const query = dialect.sqlToQuery(statement);
    captured.push({ sql: query.sql, params: query.params });
    const result = database
      .prepare(query.sql)
      .run(...(query.params as []));
    return { meta: { changes: Number(result.changes) } };
  });
  const store = createDrizzleAdminRoleStore({ run } as unknown as Database);
  return { database, captured, run, store };
}


describe("assignAdminRole", () => {
  it("assigns ADMIN to an eligible user", async () => {
    const { store, assignments } = createStore();

    await expect(assignAdminRole(store, "target")).resolves.toEqual({
      changed: true,
    });
    expect(assignments).toContain("target");
    expect(store.grantRole).toHaveBeenCalledOnce();
    expect(store.hasRole).not.toHaveBeenCalled();
  });

  it("is idempotent when the user already has ADMIN", async () => {
    const { store, assignments } = createStore({ admins: ["target"] });

    await expect(assignAdminRole(store, "target")).resolves.toEqual({
      changed: false,
    });
    expect(assignments).toEqual(new Set(["target"]));
    expect(store.grantRole).toHaveBeenCalledOnce();
    expect(store.hasRole).not.toHaveBeenCalled();
  });

  it("fails safely when the ADMIN migration invariant is missing", async () => {
    const { store } = createStore({ roleId: null });

    await expect(assignAdminRole(store, "target")).rejects.toMatchObject({
      code: "ADMIN_ROLE_MISSING",
    });
    expect(store.grantRole).not.toHaveBeenCalled();
  });

  it("rejects a user that no longer exists", async () => {
    const { store } = createStore({ users: ["actor"] });

    await expect(assignAdminRole(store, "target")).rejects.toMatchObject({
      code: "USER_NOT_FOUND",
    });
    expect(store.grantRole).not.toHaveBeenCalled();
  });
});

describe("revokeAdminRole", () => {
  it("refuses self-revocation for the signed-in admin", async () => {
    const { store } = createStore({ admins: ["actor", "target"] });

    await expect(
      revokeAdminRole(store, "actor", "actor")
    ).rejects.toMatchObject({ code: "CANNOT_REVOKE_SELF" });
    expect(store.revokeRoleIfOtherAdminExists).not.toHaveBeenCalled();
  });

  it("refuses to revoke the last remaining admin", async () => {
    const { store, assignments } = createStore({ admins: ["target"] });

    await expect(
      revokeAdminRole(store, "target", "actor")
    ).rejects.toMatchObject({ code: "LAST_ADMIN" });
    expect(assignments).toContain("target");
    expect(store.revokeRoleIfOtherAdminExists).toHaveBeenCalledOnce();
    expect(store.hasRole).toHaveBeenCalledOnce();
  });

  it("revokes another admin when at least one administrator remains", async () => {
    const { store, assignments } = createStore({
      admins: ["actor", "target"],
    });

    await expect(
      revokeAdminRole(store, "target", "actor")
    ).resolves.toEqual({ changed: true });
    expect(assignments).toEqual(new Set(["actor"]));
    expect(store.revokeRoleIfOtherAdminExists).toHaveBeenCalledOnce();
    expect(store.hasRole).not.toHaveBeenCalled();
  });

  it("does not write when the target no longer has ADMIN", async () => {
    const { store } = createStore({ admins: ["actor"] });

    await expect(
      revokeAdminRole(store, "target", "actor")
    ).resolves.toEqual({ changed: false });
    expect(store.revokeRoleIfOtherAdminExists).toHaveBeenCalledOnce();
    expect(store.hasRole).toHaveBeenCalledOnce();
  });

  it("fails safely when the ADMIN migration invariant is missing", async () => {
    const { store } = createStore({ roleId: null, admins: ["target"] });

    await expect(
      revokeAdminRole(store, "target", "actor")
    ).rejects.toMatchObject({ code: "ADMIN_ROLE_MISSING" });
    expect(store.revokeRoleIfOtherAdminExists).not.toHaveBeenCalled();
  });

  it("rejects a user that no longer exists", async () => {
    const { store } = createStore({ users: ["actor"], admins: ["target"] });

    await expect(
      revokeAdminRole(store, "target", "actor")
    ).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
    expect(store.revokeRoleIfOtherAdminExists).not.toHaveBeenCalled();
  });
});

describe("adminRoleErrorMessage", () => {
  it("exposes invariant errors to administrators", () => {
    expect(
      adminRoleErrorMessage(new AdminRoleOperationError("ADMIN_ROLE_MISSING"))
    ).toContain("latest database migrations");
  });

  it("does not expose unexpected internal errors", () => {
    expect(adminRoleErrorMessage(new Error("database credentials"))).toBe(
      "The role change could not be completed. Please try again."
    );
  });
});

describe("createDrizzleAdminRoleStore mutation SQL", () => {
  it("uses one idempotent INSERT and D1 changes for grants", async () => {
    const { database, captured, run, store } = createExecutableRoleStore();

    await expect(store.grantRole("target", "admin-role")).resolves.toBe(true);
    await expect(store.grantRole("target", "admin-role")).resolves.toBe(false);

    const row = database
      .prepare('SELECT COUNT(*) AS "count" FROM "UserRoles"')
      .get() as { count: number };
    expect(row.count).toBe(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect(captured).toHaveLength(2);
    for (const query of captured) {
      expect(query.sql.trim()).toMatch(/^INSERT INTO "UserRoles"/);
      expect(query.sql).toContain('ON CONFLICT ("userId", "roleId") DO NOTHING');
      expect(query.params).toEqual(["target", "admin-role"]);
    }
    database.close();
  });

  it("uses one conditional DELETE and D1 changes for revocation", async () => {
    const { database, captured, run, store } = createExecutableRoleStore();
    const insert = database.prepare(
      'INSERT INTO "UserRoles" ("id", "userId", "roleId") VALUES (?, ?, ?)'
    );
    insert.run("target-assignment", "target", "admin-role");

    await expect(
      store.revokeRoleIfOtherAdminExists("target", "admin-role")
    ).resolves.toBe(false);
    insert.run("actor-assignment", "actor", "admin-role");
    await expect(
      store.revokeRoleIfOtherAdminExists("target", "admin-role")
    ).resolves.toBe(true);

    const remaining = database
      .prepare('SELECT "userId" FROM "UserRoles" ORDER BY "userId"')
      .all() as Array<{ userId: string }>;
    expect(remaining).toEqual([{ userId: "actor" }]);
    expect(run).toHaveBeenCalledTimes(2);
    for (const query of captured) {
      expect(query.sql.trim()).toMatch(/^DELETE FROM "UserRoles"/);
      expect(query.sql).toContain("AND EXISTS");
      expect(query.sql).toContain('"otherAdmin"."userId" <> ?');
      expect(query.params).toEqual([
        "target",
        "admin-role",
        "admin-role",
        "target",
      ]);
    }
    database.close();
  });
});

describe("persistent ADMIN authority session policy", () => {
  it.each(["add-admin", "remove-admin"])(
    "blocks agent-authenticated %s mutations with a clear error",
    (action) => {
      expect(() =>
        assertPersistentAdminRoleMutationAllowed(
          action,
          `${AGENT_SESSION_PREFIX}SAM reviewer`
        )
      ).toThrow(
        "Agent-authenticated sessions cannot change persistent ADMIN access."
      );
    }
  );

  it("allows browser sessions and non-role actions", () => {
    expect(() =>
      assertPersistentAdminRoleMutationAllowed("add-admin", "Mozilla/5.0")
    ).not.toThrow();
    expect(() =>
      assertPersistentAdminRoleMutationAllowed(
        "unsupported",
        `${AGENT_SESSION_PREFIX}SAM reviewer`
      )
    ).not.toThrow();
  });
});
