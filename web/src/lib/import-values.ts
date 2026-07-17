export function escapeSqlValue(value: unknown): string {
  if (value == null) return "NULL";

  let serialized: string;
  if (typeof value === "string") {
    serialized = value;
  } else if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    serialized = String(value);
  } else if (typeof value === "symbol" || typeof value === "function") {
    return "NULL";
  } else {
    const json: unknown = JSON.stringify(value);
    if (typeof json !== "string") return "NULL";
    serialized = json;
  }

  return `'${serialized.replace(/'/g, "''")}'`;
}

export function toUnixSeconds(value: unknown): string | number {
  if (typeof value !== "string") return "NULL";
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) ? Math.floor(milliseconds / 1_000) : "NULL";
}

export function toSqlBoolean(value: unknown): number {
  return value ? 1 : 0;
}
