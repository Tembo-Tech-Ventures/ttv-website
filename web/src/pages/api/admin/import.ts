import type { APIRoute } from "astro";
import { env } from "cloudflare:workers";

/** Escape single quotes for SQLite string literals. */
function esc(str: unknown): string {
  if (str == null) return "NULL";
  return `'${String(str).replace(/'/g, "''")}'`;
}

/** Convert an ISO timestamp string to unix seconds, or NULL. */
function ts(value: unknown): string | number {
  if (value == null) return "NULL";
  return Math.floor(new Date(value as string).getTime() / 1000);
}

/** Convert emailVerified to integer boolean (1 | 0). */
function boolInt(value: unknown): number {
  return value ? 1 : 0;
}

interface ImportData {
  version?: number;
  exportedAt?: string;
  users?: Array<Record<string, unknown>>;
  roles?: Array<Record<string, unknown>>;
  curricula?: Array<Record<string, unknown>>;
  programs?: Array<Record<string, unknown>>;
  programRoles?: Array<Record<string, unknown>>;
  programPartners?: Array<Record<string, unknown>>;
  programApplications?: Array<Record<string, unknown>>;
  userRoles?: Array<Record<string, unknown>>;
}

type TableKey =
  | "users"
  | "roles"
  | "curricula"
  | "programs"
  | "programRoles"
  | "programPartners"
  | "programApplications"
  | "userRoles";

function generateStatements(data: ImportData): string[] {
  const stmts: string[] = [];

  // 1. user (no FK deps)
  for (const u of data.users ?? []) {
    stmts.push(
      `INSERT OR IGNORE INTO \`user\` (id, name, email, emailVerified, image) VALUES (${esc(u.id)}, ${esc(u.name ?? "")}, ${esc(u.email)}, ${boolInt(u.emailVerified)}, ${u.image != null ? esc(u.image) : "NULL"})`
    );
  }

  // 2. Roles (no FK deps)
  for (const r of data.roles ?? []) {
    stmts.push(
      `INSERT OR IGNORE INTO \`Roles\` (id, name, createdAt, updatedAt) VALUES (${esc(r.id)}, ${esc(r.name)}, ${ts(r.createdAt)}, ${ts(r.updatedAt)})`
    );
  }

  // 3. curriculum (no FK deps)
  for (const c of data.curricula ?? []) {
    stmts.push(
      `INSERT OR IGNORE INTO \`curriculum\` (id, title, description, createdAt, updatedAt) VALUES (${esc(c.id)}, ${esc(c.title)}, ${esc(c.description ?? "")}, ${ts(c.createdAt)}, ${ts(c.updatedAt)})`
    );
  }

  // 4. programPartner (no FK deps)
  for (const p of data.programPartners ?? []) {
    stmts.push(
      `INSERT OR IGNORE INTO \`programPartner\` (id, name, createdAt, updatedAt) VALUES (${esc(p.id)}, ${esc(p.name)}, ${ts(p.createdAt)}, ${ts(p.updatedAt)})`
    );
  }

  // 5. UserRoles (depends on user + Roles)
  for (const ur of data.userRoles ?? []) {
    stmts.push(
      `INSERT OR IGNORE INTO \`UserRoles\` (id, userId, roleId, createdAt, updatedAt) VALUES (${esc(ur.id)}, ${esc(ur.userId)}, ${esc(ur.roleId)}, ${ts(ur.createdAt)}, ${ts(ur.updatedAt)})`
    );
  }

  // 6. program (depends on curriculum)
  for (const p of data.programs ?? []) {
    stmts.push(
      `INSERT OR IGNORE INTO \`program\` (id, name, description, curriculumId, startDate, endDate, createdAt, updatedAt) VALUES (${esc(p.id)}, ${esc(p.name)}, ${esc(p.description ?? "")}, ${esc(p.curriculumId)}, ${ts(p.startDate)}, ${ts(p.endDate)}, ${ts(p.createdAt)}, ${ts(p.updatedAt)})`
    );
  }

  // 7. programRole (depends on program + user)
  for (const pr of data.programRoles ?? []) {
    stmts.push(
      `INSERT OR IGNORE INTO \`programRole\` (id, programId, userId, name, createdAt, updatedAt) VALUES (${esc(pr.id)}, ${esc(pr.programId)}, ${esc(pr.userId)}, ${esc(pr.name)}, ${ts(pr.createdAt)}, ${ts(pr.updatedAt)})`
    );
  }

  // 8. programApplication (depends on user + program + programPartner)
  for (const pa of data.programApplications ?? []) {
    const appJson =
      typeof pa.application === "string"
        ? pa.application
        : JSON.stringify(pa.application);
    stmts.push(
      `INSERT OR IGNORE INTO \`programApplication\` (id, programId, userId, partnerId, status, application, completedAt, createdAt, updatedAt) VALUES (${esc(pa.id)}, ${pa.programId != null ? esc(pa.programId) : "NULL"}, ${esc(pa.userId)}, ${pa.partnerId != null ? esc(pa.partnerId) : "NULL"}, ${esc(pa.status)}, ${esc(appJson)}, ${ts(pa.completedAt)}, ${ts(pa.createdAt)}, ${ts(pa.updatedAt)})`
    );
  }

  return stmts;
}

export const POST: APIRoute = async ({ request, locals }) => {
  // Auth is already checked by middleware for /api/admin/* routes...
  // but this is under /api/admin, so let's verify manually since
  // middleware only checks /admin/* paths
  if (!locals.user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
    });
  }

  // Check admin role
  const roleResult = await env.DB.prepare(
    `SELECT ur.id FROM "UserRoles" ur
     JOIN "Roles" r ON ur."roleId" = r."id"
     WHERE ur."userId" = ? AND r."name" = 'ADMIN'
     LIMIT 1`
  )
    .bind(locals.user.id)
    .first();

  if (!roleResult) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
    });
  }

  try {
    const data: ImportData = await request.json();

    // Validate format
    if (!data.version || !data.exportedAt) {
      return new Response(
        JSON.stringify({
          error:
            "Invalid export file: missing version or exportedAt fields",
        }),
        { status: 400 }
      );
    }

    const statements = generateStatements(data);

    if (statements.length === 0) {
      return new Response(
        JSON.stringify({ error: "No records found in export file" }),
        { status: 400 }
      );
    }

    // Execute all statements in a batch
    const db = env.DB;
    const prepared = statements.map((sql) => db.prepare(sql));
    await db.batch(prepared);

    // Count successes per table
    const tables: Array<{ key: TableKey; label: string }> = [
      { key: "users", label: "Users" },
      { key: "roles", label: "Roles" },
      { key: "curricula", label: "Curricula" },
      { key: "programPartners", label: "Program Partners" },
      { key: "userRoles", label: "User Roles" },
      { key: "programs", label: "Programs" },
      { key: "programRoles", label: "Program Roles" },
      { key: "programApplications", label: "Program Applications" },
    ];

    const imported: Record<string, number> = {};
    for (const t of tables) {
      imported[t.key] = (data[t.key] ?? []).length;
    }

    return new Response(
      JSON.stringify({
        success: true,
        totalStatements: statements.length,
        imported,
      }),
      { status: 200 }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
    });
  }
};
