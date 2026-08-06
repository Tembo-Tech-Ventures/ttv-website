import { and, eq, sql } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import { isAgentSession } from "@/lib/agent-auth";

export const ADMIN_ROLE_NAME = "ADMIN";

export type AdminRoleErrorCode =
  | "ADMIN_ROLE_MISSING"
  | "USER_NOT_FOUND"
  | "CANNOT_REVOKE_SELF"
  | "AGENT_SESSION_FORBIDDEN"
  | "LAST_ADMIN";

const ERROR_MESSAGES: Record<AdminRoleErrorCode, string> = {
  ADMIN_ROLE_MISSING:
    "The ADMIN role is missing. Apply the latest database migrations before changing access.",
  USER_NOT_FOUND: "The selected user no longer exists.",
  CANNOT_REVOKE_SELF: "You cannot remove your own ADMIN role.",
  AGENT_SESSION_FORBIDDEN:
    "Agent-authenticated sessions cannot change persistent ADMIN access. Sign in with a browser session.",
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
  grantRole(userId: string, roleId: string): Promise<boolean>;
  revokeRoleIfOtherAdminExists(userId: string, roleId: string): Promise<boolean>;
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
    async grantRole(userId, roleId) {
      const result = await db.run(sql`
        INSERT INTO "UserRoles" ("id", "userId", "roleId")
        VALUES (lower(hex(randomblob(16))), ${userId}, ${roleId})
        ON CONFLICT ("userId", "roleId") DO NOTHING
      `);
      return (result.meta.changes ?? 0) > 0;
    },
    async revokeRoleIfOtherAdminExists(userId, roleId) {
      const result = await db.run(sql`
        DELETE FROM "UserRoles"
        WHERE "userId" = ${userId}
          AND "roleId" = ${roleId}
          AND EXISTS (
            SELECT 1
            FROM "UserRoles" AS "otherAdmin"
            WHERE "otherAdmin"."roleId" = ${roleId}
              AND "otherAdmin"."userId" <> ${userId}
          )
      `);
      return (result.meta.changes ?? 0) > 0;
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
  return { changed: await store.grantRole(targetUserId, adminRole.id) };
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

  if (await store.revokeRoleIfOtherAdminExists(targetUserId, adminRole.id)) {
    return { changed: true };
  }

  if (await store.hasRole(targetUserId, adminRole.id)) {
    throw new AdminRoleOperationError("LAST_ADMIN");
  }
  return { changed: false };
}

export function assertPersistentAdminRoleMutationAllowed(
  action: unknown,
  userAgent: string | null | undefined
): void {
  const changesPersistentAccess =
    action === "add-admin" || action === "remove-admin";

  if (changesPersistentAccess && isAgentSession(userAgent)) {
    throw new AdminRoleOperationError("AGENT_SESSION_FORBIDDEN");
  }
}

export function adminRoleErrorMessage(error: unknown): string {
  if (error instanceof AdminRoleOperationError) return error.message;
  return "The role change could not be completed. Please try again.";
}
