import { describe, expect, it } from "vitest";
import { escapeSqlValue, toSqlBoolean, toUnixSeconds } from "@/lib/import-values";

describe("data import value serialization", () => {
  it("escapes strings and serializes structured values without object coercion", () => {
    expect(escapeSqlValue("Tembo's")).toBe("'Tembo''s'");
    expect(escapeSqlValue({ cohort: "A" })).toBe('\'{"cohort":"A"}\'');
    expect(escapeSqlValue(null)).toBe("NULL");
    expect(escapeSqlValue(undefined)).toBe("NULL");
    expect(escapeSqlValue(2n)).toBe("'2'");
    expect(escapeSqlValue(Symbol("unsupported"))).toBe("NULL");
    expect(escapeSqlValue(() => "unsupported")).toBe("NULL");
  });

  it("accepts valid ISO timestamps and fails invalid values to SQL NULL", () => {
    expect(toUnixSeconds("1970-01-01T00:01:00.000Z")).toBe(60);
    expect(toUnixSeconds("not-a-date")).toBe("NULL");
    expect(toUnixSeconds({})).toBe("NULL");
  });

  it("normalizes truthy export flags to SQLite integers", () => {
    expect(toSqlBoolean(true)).toBe(1);
    expect(toSqlBoolean("true")).toBe(1);
    expect(toSqlBoolean(false)).toBe(0);
  });
});
