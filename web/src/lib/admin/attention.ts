import { redactErrorMessage } from "@/lib/observability/errors";

export interface AdminAttentionItem {
  id: string;
  title: string;
  detail: string;
  href: string;
  occurredAt: string;
}

export interface AdminAttentionGroup {
  id: "failed-recordings" | "import-errors" | "error-signatures" | "pending-projects" | "stale-contacts";
  label: string;
  items: AdminAttentionItem[];
}

interface FailedRecordingRow {
  id: string;
  title: string;
  processingError: string | null;
  updatedAt: number;
}

interface ImportErrorRow {
  id: string;
  name: string;
  lastError: string;
  updatedAt: number;
}

interface ErrorSignatureRow {
  signature: string;
  source: string;
  route: string;
  count: number;
  lastSeenAt: number;
}

interface PendingProjectRow {
  id: string;
  title: string;
  organization: string;
  createdAt: number;
}

interface StaleContactRow {
  id: string;
  profileId: string;
  fromName: string;
  profileName: string;
  createdAt: number;
}

function rows<T>(result: D1Result<unknown> | undefined) {
  return (result?.results ?? []) as T[];
}

function iso(seconds: number) {
  return new Date(Number(seconds) * 1_000).toISOString();
}

export async function getAdminAttention(
  db: D1Database,
  now = new Date()
): Promise<AdminAttentionGroup[]> {
  const nowSeconds = Math.floor(now.getTime() / 1_000);
  const threeDaysAgo = nowSeconds - 3 * 24 * 60 * 60;
  const sevenDaysAgo = nowSeconds - 7 * 24 * 60 * 60;
  const results = await db.batch([
    db.prepare(
      `SELECT "id", "title", "processingError", "updatedAt"
       FROM "recording"
       WHERE "processingStatus" = 'failed'
       ORDER BY "updatedAt" DESC
       LIMIT 10`
    ),
    db.prepare(
      `SELECT "id", "name", "lastError", "updatedAt"
       FROM "recording_import_source"
       WHERE "lastError" IS NOT NULL AND trim("lastError") <> ''
       ORDER BY "updatedAt" DESC
       LIMIT 10`
    ),
    db
      .prepare(
        `SELECT "signature", "source", "route", "count", "lastSeenAt"
         FROM "errorEvent"
         WHERE "lastSeenAt" >= ?
         ORDER BY "count" DESC, "lastSeenAt" DESC
         LIMIT 10`
      )
      .bind(sevenDaysAgo),
    db
      .prepare(
        `SELECT "id", "title", "organization", "createdAt"
         FROM "clientProject"
         WHERE "status" = 'PENDING' AND "createdAt" < ?
         ORDER BY "createdAt" ASC
         LIMIT 10`
      )
      .bind(threeDaysAgo),
    db
      .prepare(
        `SELECT c."id", c."profileId", c."fromName", c."createdAt",
                u."name" AS "profileName"
         FROM "profileContact" AS c
         JOIN "studentProfile" AS p ON p."id" = c."profileId"
         JOIN "user" AS u ON u."id" = p."userId"
         WHERE c."status" = 'NEW' AND c."createdAt" < ?
         ORDER BY c."createdAt" ASC
         LIMIT 10`
      )
      .bind(sevenDaysAgo),
  ]);

  return [
    {
      id: "failed-recordings",
      label: "Failed recordings",
      items: rows<FailedRecordingRow>(results[0]).map((row) => ({
        id: row.id,
        title: row.title,
        detail: redactErrorMessage(row.processingError || "Processing failed"),
        href: `/admin/recordings/${encodeURIComponent(row.id)}`,
        occurredAt: iso(row.updatedAt),
      })),
    },
    {
      id: "import-errors",
      label: "Recording import errors",
      items: rows<ImportErrorRow>(results[1]).map((row) => ({
        id: row.id,
        title: row.name,
        detail: redactErrorMessage(row.lastError),
        href: "/admin/recordings/import",
        occurredAt: iso(row.updatedAt),
      })),
    },
    {
      id: "error-signatures",
      label: "Top error signatures (7 days)",
      items: rows<ErrorSignatureRow>(results[2]).map((row) => ({
        id: row.signature,
        title: `${row.source} · ${row.route}`,
        detail: `${row.count} occurrence${row.count === 1 ? "" : "s"}`,
        href: "/admin#attention-error-signatures",
        occurredAt: iso(row.lastSeenAt),
      })),
    },
    {
      id: "pending-projects",
      label: "Pending client projects (over 3 days)",
      items: rows<PendingProjectRow>(results[3]).map((row) => ({
        id: row.id,
        title: row.title,
        detail: row.organization,
        href: `/admin/projects/${encodeURIComponent(row.id)}`,
        occurredAt: iso(row.createdAt),
      })),
    },
    {
      id: "stale-contacts",
      label: "New contact notes (over 7 days)",
      items: rows<StaleContactRow>(results[4]).map((row) => ({
        id: row.id,
        title: `Contact from ${row.fromName}`,
        detail: `For ${row.profileName}`,
        href: `/admin/profiles/${encodeURIComponent(row.profileId)}`,
        occurredAt: iso(row.createdAt),
      })),
    },
  ];
}
