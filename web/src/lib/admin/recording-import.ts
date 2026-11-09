import { and, eq } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import { parseGoogleDriveFolderId } from "@/lib/recordings/google-drive";

/*
 * The admin's Google Drive import sources: the form that adds one, and turning
 * a source's automatic scans on or off from what the page showed. Scans and
 * the historical import themselves are lib/recordings/importer.ts.
 */

export const SOURCE_NAME_MAX = 120;
export const FILTER_MAX = 200;

export type SourceValues = { name: string; programId: string; driveFolder: string; filenameContains: string };
export type SourceErrors = Partial<Record<keyof SourceValues, string>>;
export type NewSource = { name: string; programId: string; driveFolderId: string; filenameContains: string | null };

const text = (formData: FormData, name: string) => {
  const value = formData.get(name);
  return typeof value === "string" ? value.trim() : "";
};

/** The new source as the admin wrote it, what is wrong with it, and the row to write when nothing is. */
export function sourceFromForm(
  formData: FormData,
  programIds: readonly string[],
): { values: SourceValues; errors: SourceErrors; source?: NewSource } {
  const values: SourceValues = {
    name: text(formData, "name"),
    programId: text(formData, "programId"),
    driveFolder: text(formData, "driveFolder"),
    filenameContains: text(formData, "filenameContains"),
  };
  const errors: SourceErrors = {};
  if (!values.name) errors.name = "Name the source, such as the cohort it imports for.";
  else if (values.name.length > SOURCE_NAME_MAX) errors.name = `Keep the name to ${SOURCE_NAME_MAX} characters.`;
  if (!values.programId) errors.programId = "Choose the cohort its recordings belong to.";
  else if (!programIds.includes(values.programId)) errors.programId = "Choose a cohort from the list.";
  let driveFolderId = "";
  if (!values.driveFolder) errors.driveFolder = "Paste the Drive folder's address, or its ID.";
  else {
    try {
      driveFolderId = parseGoogleDriveFolderId(values.driveFolder);
    } catch {
      errors.driveFolder = "That isn't a Drive folder's address or ID. Copy the address of the folder itself from Drive.";
    }
  }
  if (values.filenameContains.length > FILTER_MAX) errors.filenameContains = `Keep the filter to ${FILTER_MAX} characters.`;
  if (Object.keys(errors).length > 0) return { values, errors };
  return { values, errors, source: { name: values.name, programId: values.programId, driveFolderId, filenameContains: values.filenameContains || null } };
}

export type ToggleResult = { ok: true; enabled: boolean } | { ok: false; reason: "missing" | "changed" };

/**
 * Turns a source's automatic scans on or off, only from the state the page
 * showed: a second admin who already changed it isn't undone.
 */
export async function setSourceEnabled(db: Database, sourceId: string, expected: boolean): Promise<ToggleResult> {
  const changed = await db
    .update(schema.recordingImportSource)
    .set({ enabled: !expected })
    .where(and(eq(schema.recordingImportSource.id, sourceId), eq(schema.recordingImportSource.enabled, expected)))
    .returning({ id: schema.recordingImportSource.id });
  if (changed.length > 0) return { ok: true, enabled: !expected };
  const exists = await db.query.recordingImportSource.findFirst({ where: eq(schema.recordingImportSource.id, sourceId), columns: { id: true } });
  return { ok: false, reason: exists ? "changed" : "missing" };
}

/** The `enabled` the page posted, as the boolean it showed; anything else is null. */
export function expectedEnabled(value: FormDataEntryValue | null): boolean | null {
  return value === "true" ? true : value === "false" ? false : null;
}

/** A count the review showed and the confirm form carried back, or null if it isn't one. */
export function reviewedCount(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || !/^\d{1,9}$/.test(value)) return null;
  return Number(value);
}
