import {
  LegacyImportValidationError,
  PRIVILEGE_TABLE_KEYS,
  preflightLegacyImport,
  type ImportableTableKey,
  type LegacyImportResult,
  type PrivilegeTableKey,
} from "@/lib/admin/import";

/*
 * The legacy data migration page, as a server form: the admin uploads a legacy
 * export, the server reviews it (the same preflight the import runs, so a
 * colliding identity or a broken reference is found before anything is
 * written), and a second form imports what was reviewed. lib/admin/import.ts
 * owns the import itself.
 */

/** Large enough for any legacy export, small enough to carry back in the confirm form. */
export const MAX_EXPORT_BYTES = 5 * 1024 * 1024;

/** Every section of an export, as the page names it, in the order the import writes them. */
export const EXPORT_TABLES: readonly { key: ImportableTableKey | PrivilegeTableKey; label: string }[] = [
  { key: "users", label: "Users" },
  { key: "curricula", label: "Curricula" },
  { key: "programPartners", label: "Program partners" },
  { key: "programs", label: "Programs" },
  { key: "programRoles", label: "Program roles" },
  { key: "programApplications", label: "Program applications" },
  { key: "roles", label: "Roles" },
  { key: "userRoles", label: "User roles" },
];

const PRIVILEGE = new Set<string>(PRIVILEGE_TABLE_KEYS);
export const isPrivilegeTable = (key: string): key is PrivilegeTableKey => PRIVILEGE.has(key);

export type ExportFile = { ok: true; text: string; payload: unknown } | { ok: false; error: string };

/** The export the form carries, as a chosen file (`export`) or the reviewed text sent back (`exportText`). */
export async function exportFromForm(formData: FormData): Promise<ExportFile> {
  const file = formData.get("export");
  const carried = formData.get("exportText");
  let text: string;
  if (file instanceof File && file.size > 0) {
    if (file.size > MAX_EXPORT_BYTES) return { ok: false, error: "That file is larger than 5 MB, so it isn't a legacy export. Choose the JSON file the export tool wrote." };
    text = await file.text();
  } else if (typeof carried === "string" && carried) {
    if (carried.length > MAX_EXPORT_BYTES) return { ok: false, error: "The reviewed export didn't come back whole. Choose the file and review it again." };
    text = carried;
  } else {
    return { ok: false, error: "Choose the legacy JSON export to review." };
  }
  try {
    return { ok: true, text, payload: JSON.parse(text) as unknown };
  } catch {
    return { ok: false, error: "That file isn't JSON. Choose the JSON file the legacy export tool wrote." };
  }
}

export type ExportReview = {
  version: number;
  exportedAt: Date;
  rows: { key: string; label: string; privilege: boolean; records: number }[];
  importable: number;
  ignored: number;
};

/**
 * What the export would import, after the same checks the import makes. A
 * problem with the export is a LegacyImportValidationError, said to the admin
 * as it is; anything else is the database's.
 */
export async function reviewExport(db: D1Database, payload: unknown): Promise<ExportReview> {
  const plan = await preflightLegacyImport(db, payload);
  const root = payload as { version: number; exportedAt: string };
  const rows = EXPORT_TABLES.map(({ key, label }) => {
    const privilege = isPrivilegeTable(key);
    const records = isPrivilegeTable(key) ? plan.ignored[key] : plan.attempted[key];
    return { key, label, privilege, records };
  });
  return {
    version: root.version,
    exportedAt: new Date(root.exportedAt),
    rows,
    importable: rows.filter((row) => !row.privilege).reduce((total, row) => total + row.records, 0),
    ignored: rows.filter((row) => row.privilege).reduce((total, row) => total + row.records, 0),
  };
}

/** The import's outcome in a sentence, with the tables it changed: what the flash says. */
export function importSummary(result: LegacyImportResult): string {
  const changed = EXPORT_TABLES.filter(({ key }) => !isPrivilegeTable(key) && result.imported[key as ImportableTableKey] > 0)
    .map(({ key, label }) => `${label.toLowerCase()} ${result.imported[key as ImportableTableKey]}`);
  return [
    `${result.totalChanges} rows changed, ${result.totalSkipped} already there and skipped, ${result.totalIgnored} privilege records ignored.`,
    changed.length > 0 ? `Changed: ${changed.join(", ")}.` : "",
  ].filter(Boolean).join(" ");
}

export { LegacyImportValidationError };
