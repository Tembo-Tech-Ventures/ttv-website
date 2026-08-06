import { and, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";

export const ADMIN_ROLE_NAME = "ADMIN";

export type AdminRoleErrorCode =
  | "ADMIN_ROLE_MISSING"
  | "USER_NOT_FOUND"
  | "CANNOT_REVOKE_SELF"
  | "LAST_ADMIN";

const ERROR_MESSAGES: Record<AdminRoleErrorCode, string> = {
  ADMIN_ROLE_MISSING:
    "The ADMIN role is missing. Apply the latest database migrations before changing access.",
  USER_NOT_FOUND: "The selected user no longer exists.",
  CANNOT_REVOKE_SELF: "You cannot remove your own ADMIN role.",
  LAST_ADMIN:
    "This ADMIN role cannot be removed because at least one administrator must remain.",
};

export class AdminRoleOperationError extends Error {
  constructor(public readonly code: AdminRoleErrorCode) {
    super(ERROR_MESSAGES[code]);
    this.name = "AdminRoleOperationError";
  }
}

interface RoleRecord {
  id: string;
}

export interface AdminRoleStore {
  findRoleByName(name: string): Promise<RoleRecord | undefined>;
  userExists(userId: string): Promise<boolean>;
  hasRole(userId: string, roleId: string): Promise<boolean>;
  addRole(userId: string, roleId: string): Promise<void>;
  countUsersWithRole(roleId: string): Promise<number>;
  removeRole(userId: string, roleId: string): Promise<void>;
}

export interface AdminRoleChange {
  changed: boolean;
}

export function createDrizzleAdminRoleStore(db: Database): AdminRoleStore {
  return {
    async findRoleByName(name) {
      return db.query.role.findFirst({
        where: eq(schema.role.name, name),
        columns: { id: true },
      });
    },
    async userExists(userId) {
      const found = await db.query.user.findFirst({
        where: eq(schema.user.id, userId),
        columns: { id: true },
      });
      return Boolean(found);
    },
    async hasRole(userId, roleId) {
      const found = await db.query.userRole.findFirst({
        where: and(
          eq(schema.userRole.userId, userId),
          eq(schema.userRole.roleId, roleId)
        ),
        columns: { id: true },
      });
      return Boolean(found);
    },
    async addRole(userId, roleId) {
      await db.insert(schema.userRole).values({ userId, roleId });
    },
    async countUsersWithRole(roleId) {
      const rows = await db
        .selectDistinct({ userId: schema.userRole.userId })
        .from(schema.userRole)
        .where(eq(schema.userRole.roleId, roleId));
      return rows.length;
    },
    async removeRole(userId, roleId) {
      await db
        .delete(schema.userRole)
        .where(
          and(
            eq(schema.userRole.userId, userId),
            eq(schema.userRole.roleId, roleId)
          )
        );
    },
  };
}

async function requireRoleAndUser(
  store: AdminRoleStore,
  targetUserId: string
): Promise<RoleRecord> {
  const [adminRole, targetExists] = await Promise.all([
    store.findRoleByName(ADMIN_ROLE_NAME),
    store.userExists(targetUserId),
  ]);

  if (!adminRole) {
    throw new AdminRoleOperationError("ADMIN_ROLE_MISSING");
  }
  if (!targetExists) {
    throw new AdminRoleOperationError("USER_NOT_FOUND");
  }
  return adminRole;
}

export async function assignAdminRole(
  store: AdminRoleStore,
  targetUserId: string
): Promise<AdminRoleChange> {
  const adminRole = await requireRoleAndUser(store, targetUserId);
  if (await store.hasRole(targetUserId, adminRole.id)) {
    return { changed: false };
  }

  await store.addRole(targetUserId, adminRole.id);
  return { changed: true };
}

export async function revokeAdminRole(
  store: AdminRoleStore,
  targetUserId: string,
  signedInAdminId: string
): Promise<AdminRoleChange> {
  const adminRole = await requireRoleAndUser(store, targetUserId);

  if (targetUserId === signedInAdminId) {
    throw new AdminRoleOperationError("CANNOT_REVOKE_SELF");
  }

  if (!(await store.hasRole(targetUserId, adminRole.id))) {
    return { changed: false };
  }

  if ((await store.countUsersWithRole(adminRole.id)) <= 1) {
    throw new AdminRoleOperationError("LAST_ADMIN");
  }

  await store.removeRole(targetUserId, adminRole.id);
  return { changed: true };
}

export function adminRoleErrorMessage(error: unknown): string {
  if (error instanceof AdminRoleOperationError) return error.message;
  return "The role change could not be completed. Please try again.";
}
