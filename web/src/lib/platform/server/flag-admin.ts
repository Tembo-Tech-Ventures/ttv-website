import { Flag, FlagKey, FlagsAdmin } from "./flag-contracts";

type FlagRow = Flag;

function toFlag(row: FlagRow): Flag {
  // D1 stores Unix seconds; the platform contract uses epoch milliseconds.
  return Flag.parse({ ...row, updatedAt: row.updatedAt * 1_000 });
}

export async function listFlags(db: D1Database): Promise<FlagsAdmin> {
  const { results } = await db.prepare(
    "SELECT key, audience, updatedAt, updatedBy FROM feature_flag WHERE key IN (?, ?, ?, ?) ORDER BY key"
  ).bind(...FlagKey.options).all<FlagRow>();
  return FlagsAdmin.parse({ flags: results.map(toFlag) });
}

export async function updateFlag(
  db: D1Database,
  key: Flag["key"],
  audience: Flag["audience"],
  actorId: string
): Promise<Flag | null> {
  const row = await db.prepare(
    `UPDATE feature_flag SET audience = ?, updatedAt = unixepoch(), updatedBy = ?
     WHERE key = ? RETURNING key, audience, updatedAt, updatedBy`
  ).bind(audience, actorId, key).first<FlagRow>();
  return row ? toFlag(row) : null;
}
