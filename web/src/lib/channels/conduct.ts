import { ConductAcknowledgement } from "@/lib/platform/contracts";

/**
 * The channel code of conduct, "How we talk to each other" (README.md beside this file). Each
 * person's latest agreement is one channel_conduct row. Raise CONDUCT_VERSION whenever the text
 * changes in substance: everyone who agreed to an older version is asked again. Timestamps are
 * epoch milliseconds. Callers own authentication and the `channels` flag; agreeing is a person's
 * own act, so callers refuse personal access tokens.
 */
export const CONDUCT_VERSION = 1;

interface ConductRow { version: number; acknowledgedAt: number }
/** currentVersion exists so a version bump can be tested before the text changes. */
interface ConductOptions { currentVersion?: number }

function acknowledgement(row: ConductRow | null, currentVersion: number): ConductAcknowledgement | null {
  return row && ConductAcknowledgement.parse({ ...row, current: row.version >= currentVersion });
}

/** The caller's latest agreement, or null when they have never agreed. One primary-key read. */
export async function getConductAcknowledgement(
  db: D1Database, userId: string, { currentVersion = CONDUCT_VERSION }: ConductOptions = {},
): Promise<ConductAcknowledgement | null> {
  const row = await db.prepare("SELECT version, acknowledgedAt FROM channel_conduct WHERE userId = ?")
    .bind(userId).first<ConductRow>();
  return acknowledgement(row, currentVersion);
}

/**
 * Records agreement to `version` (by default the current one) and returns what is stored, in one
 * statement. An agreement never moves backwards, and agreeing again to the same version keeps its
 * original date, so "You agreed to this on …" stays true. A version this deployment does not know
 * is refused: it would mark a text nobody was shown as read.
 */
export async function acknowledgeConduct(
  db: D1Database, userId: string, version: number = CONDUCT_VERSION,
  { now = Date.now(), currentVersion = CONDUCT_VERSION }: ConductOptions & { now?: number } = {},
): Promise<ConductAcknowledgement> {
  if (!Number.isInteger(version) || version < 1 || version > currentVersion) {
    throw new RangeError(`Unknown code of conduct version: ${version}`);
  }
  // SET expressions all read the row as it was, so the date changes only with a newer version.
  const row = await db.prepare(`INSERT INTO channel_conduct (userId, version, acknowledgedAt) VALUES (?1, ?2, ?3)
    ON CONFLICT (userId) DO UPDATE SET
      acknowledgedAt = CASE WHEN excluded.version > version THEN excluded.acknowledgedAt ELSE acknowledgedAt END,
      version = max(version, excluded.version)
    RETURNING version, acknowledgedAt`).bind(userId, version, now).first<ConductRow>();
  const result = acknowledgement(row, currentVersion);
  if (!result) throw new Error("Code of conduct agreement was not stored.");
  return result;
}
