import { Flag, FlagKey, FlagsAdmin } from "@/lib/platform/contracts";

type FlagRow = Flag;

function toFlag(row: FlagRow): Flag {
  // D1 stores Unix seconds; the platform contract uses epoch milliseconds.
  return Flag.parse({ ...row, updatedAt: row.updatedAt * 1_000 });
}

export async function listFlags(db: D1Database): Promise<FlagsAdmin> {
  const { results } = await db.prepare(
    `SELECT key, audience, updatedAt, updatedBy FROM feature_flag WHERE key IN (${FlagKey.options.map(() => "?").join(", ")}) ORDER BY key`
  ).bind(...FlagKey.options).all<FlagRow>();
  return FlagsAdmin.parse({ flags: FlagKey.options.map(key => {
    const row = results.find(flag => flag.key === key);
    // Missing reference data fails closed. Zero denotes no recorded update;
    // the next admin PUT can restore the row without console SQL.
    return row ? toFlag(row) : { key, audience: "OFF", updatedAt: 0, updatedBy: null };
  }) });
}

export async function updateFlag(
  db: D1Database,
  key: Flag["key"],
  audience: Flag["audience"],
  actorId: string
): Promise<Flag> {
  const row = await db.prepare(
    `INSERT INTO feature_flag(key, audience, updatedBy) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET audience = excluded.audience,
       updatedAt = unixepoch(), updatedBy = excluded.updatedBy
     RETURNING key, audience, updatedAt, updatedBy`
  ).bind(FlagKey.parse(key), audience, actorId).first<FlagRow>();
  if (!row) throw new Error("Feature flag update returned no row");
  return toFlag(row);
}
