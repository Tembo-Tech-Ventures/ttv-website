import {
  normalizeHandle,
  validateHandle,
  RESERVED_HANDLES,
} from "@/lib/talent/handles";

/** Identity names are available without fetching GitHub or depending on OAuth tokens. */
function handleBase(name: string): string {
  let base = normalizeHandle(
    name.normalize("NFKD").replace(/[\u0300-\u036F]/g, ""),
  )
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 24)
    .replace(/-$/, "");
  if (RESERVED_HANDLES.has(base)) base += "-member";
  return validateHandle(base).ok ? base : "member";
}

/** One bounded aggregate, then the unique index arbitrates concurrent allocations. */
export async function nextMemberHandle(
  db: D1Database,
  name: string,
): Promise<string> {
  const base = handleBase(name);
  const occupied = await db
    .prepare(
      `SELECT count(*) AS count,
    max(CASE WHEN handle=? THEN 1 ELSE CAST(substr(handle,?) AS INTEGER) END) AS suffix
    FROM studentProfile WHERE handle=? OR handle GLOB ?`,
    )
    .bind(base, base.length + 2, base, `${base}-[0-9]*`)
    .first<{ count: number; suffix: number | null }>();
  if (!occupied?.count && base !== "member") return base;
  return `${base}-${Math.max(base === "member" ? 0 : 1, occupied?.suffix ?? 0) + 1}`;
}
