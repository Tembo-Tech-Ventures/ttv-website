/**
 * A D1 test double whose every call answers on a later macrotask, as a real round trip does: calls
 * started together overlap, and a call that waits for another starts after it. With the server trace
 * (src/lib/observability/perf-trace.ts) this gives a deterministic count of sequential round trips.
 */
const roundTrip = () => new Promise<void>((resolve) => {
  setImmediate(resolve);
});

type Statement = Record<string, unknown> & { bind(...values: unknown[]): Statement };

function delayed(statement: Statement): Statement {
  const copy = Object.create(statement) as Statement;
  for (const kind of ["first", "all", "run", "raw"]) {
    const original = statement[kind];
    if (typeof original !== "function") continue;
    copy[kind] = async function (this: unknown, ...args: unknown[]) {
      await roundTrip();
      return original.apply(this, args);
    };
  }
  copy.bind = (...values: unknown[]) => delayed(statement.bind(...values));
  return copy;
}

export function withRoundTrips(db: D1Database): D1Database {
  const inner = db as unknown as { prepare(sql: string): Statement; batch(statements: unknown[]): Promise<unknown> };
  return {
    prepare: (sql: string) => delayed(inner.prepare(sql)),
    batch: async (statements: unknown[]) => {
      await roundTrip();
      return inner.batch(statements);
    },
  } as unknown as D1Database;
}
