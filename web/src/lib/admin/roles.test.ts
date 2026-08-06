import { describe, expect, it, vi } from "vitest";
import {
  AdminRoleOperationError,
  adminRoleErrorMessage,
  assignAdminRole,
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
    addRole: vi.fn(async (userId) => {
      assignments.add(userId);
    }),
    countUsersWithRole: vi.fn(async () => assignments.size),
    removeRole: vi.fn(async (userId) => {
      assignments.delete(userId);
    }),
  };
  return { store, assignments };
}

describe("assignAdminRole", () => {
  it("assigns ADMIN to an eligible user", async () => {
    const { store, assignments } = createStore();

    await expect(assignAdminRole(store, "target")).resolves.toEqual({
      changed: true,
    });
    expect(assignments).toContain("target");
    expect(store.addRole).toHaveBeenCalledOnce();
  });

  it("is idempotent when the user already has ADMIN", async () => {
    const { store, assignments } = createStore({ admins: ["target"] });

    await expect(assignAdminRole(store, "target")).resolves.toEqual({
      changed: false,
    });
    expect(assignments).toEqual(new Set(["target"]));
    expect(store.addRole).not.toHaveBeenCalled();
  });

  it("fails safely when the ADMIN migration invariant is missing", async () => {
    const { store } = createStore({ roleId: null });

    await expect(assignAdminRole(store, "target")).rejects.toMatchObject({
      code: "ADMIN_ROLE_MISSING",
    });
    expect(store.addRole).not.toHaveBeenCalled();
  });

  it("rejects a user that no longer exists", async () => {
    const { store } = createStore({ users: ["actor"] });

    await expect(assignAdminRole(store, "target")).rejects.toMatchObject({
      code: "USER_NOT_FOUND",
    });
    expect(store.addRole).not.toHaveBeenCalled();
  });
});

describe("revokeAdminRole", () => {
  it("refuses self-revocation for the signed-in admin", async () => {
    const { store } = createStore({ admins: ["actor", "target"] });

    await expect(
      revokeAdminRole(store, "actor", "actor")
    ).rejects.toMatchObject({ code: "CANNOT_REVOKE_SELF" });
    expect(store.removeRole).not.toHaveBeenCalled();
  });

  it("refuses to revoke the last remaining admin", async () => {
    const { store, assignments } = createStore({ admins: ["target"] });

    await expect(
      revokeAdminRole(store, "target", "actor")
    ).rejects.toMatchObject({ code: "LAST_ADMIN" });
    expect(assignments).toContain("target");
    expect(store.removeRole).not.toHaveBeenCalled();
  });

  it("revokes another admin when at least one administrator remains", async () => {
    const { store, assignments } = createStore({
      admins: ["actor", "target"],
    });

    await expect(
      revokeAdminRole(store, "target", "actor")
    ).resolves.toEqual({ changed: true });
    expect(assignments).toEqual(new Set(["actor"]));
    expect(store.removeRole).toHaveBeenCalledOnce();
  });

  it("does not write when the target no longer has ADMIN", async () => {
    const { store } = createStore({ admins: ["actor"] });

    await expect(
      revokeAdminRole(store, "target", "actor")
    ).resolves.toEqual({ changed: false });
    expect(store.countUsersWithRole).not.toHaveBeenCalled();
    expect(store.removeRole).not.toHaveBeenCalled();
  });

  it("fails safely when the ADMIN migration invariant is missing", async () => {
    const { store } = createStore({ roleId: null, admins: ["target"] });

    await expect(
      revokeAdminRole(store, "target", "actor")
    ).rejects.toMatchObject({ code: "ADMIN_ROLE_MISSING" });
    expect(store.removeRole).not.toHaveBeenCalled();
  });

  it("rejects a user that no longer exists", async () => {
    const { store } = createStore({ users: ["actor"], admins: ["target"] });

    await expect(
      revokeAdminRole(store, "target", "actor")
    ).rejects.toMatchObject({ code: "USER_NOT_FOUND" });
    expect(store.removeRole).not.toHaveBeenCalled();
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
