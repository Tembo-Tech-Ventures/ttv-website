import { describe, expect, it, vi } from "vitest";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type { SQL } from "drizzle-orm";
import type { Database } from "@/lib/db/schema";
import { TOOL_DEFINITIONS, executeTool, type ToolContext } from "./tools";

const dialect = new SQLiteSyncDialect();

/**
 * Captures the `where` clause handed to the query builder and renders it back to
 * SQL, so a test can assert on the access constraint that was actually applied
 * rather than on the rows a hand-written fake chose to return.
 */
function createSelectDatabase(rows: unknown[] = []) {
  const captured: string[] = [];
  const limit = vi.fn().mockResolvedValue(rows);
  const orderBy = vi.fn(() => ({ limit }));
  const where = vi.fn((clause: SQL) => {
    captured.push(dialect.sqlToQuery(clause).sql);
    return { orderBy };
  });
  const from = vi.fn(() => ({ where }));
  const db = { select: vi.fn(() => ({ from })) } as unknown as Database;
  return { db, captured };
}

function createContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    env: {} as Env,
    db: createSelectDatabase().db,
    userId: "user-1",
    userName: "Amina",
    programIds: [],
    isAdmin: false,
    sources: [],
    ...overrides,
  };
}

describe("chat tool access boundaries", () => {
  describe("list_recordings", () => {
    it("returns nothing for a non-admin with no accessible programs", async () => {
      const { db, captured } = createSelectDatabase([
        { id: "rec-other-program", title: "Some other cohort", durationSeconds: 60, recordedAt: null, programId: "program-b" },
      ]);
      const ctx = createContext({ db, programIds: [], isAdmin: false });

      const result = JSON.parse(await executeTool("list_recordings", {}, ctx));

      expect(result).toEqual({ recordings: [] });
      // It must not fall through to an unconstrained query at all.
      expect(captured).toEqual([]);
    });

    it("constrains the query to the user's programs", async () => {
      const { db, captured } = createSelectDatabase([]);
      const ctx = createContext({ db, programIds: ["program-a"], isAdmin: false });

      await executeTool("list_recordings", {}, ctx);

      expect(captured).toHaveLength(1);
      expect(captured[0]).toContain('"programId"');
    });

    it("does not constrain by program for an admin", async () => {
      const { db, captured } = createSelectDatabase([]);
      const ctx = createContext({ db, programIds: [], isAdmin: true });

      await executeTool("list_recordings", {}, ctx);

      expect(captured).toHaveLength(1);
      expect(captured[0]).not.toContain('"programId"');
    });
  });

  describe("get_recording_details", () => {
    function createRecordingDatabase(recording: unknown) {
      return {
        query: { recording: { findFirst: vi.fn().mockResolvedValue(recording) } },
      } as unknown as Database;
    }

    it("refuses a recording belonging to a program the user cannot access", async () => {
      const ctx = createContext({
        db: createRecordingDatabase({ id: "rec-1", programId: "program-b", transcriptText: "secret" }),
        programIds: ["program-a"],
      });

      const result = JSON.parse(await executeTool("get_recording_details", { recording_id: "rec-1" }, ctx));

      expect(result.error).toMatch(/do not have access/i);
      expect(result.transcript).toBeUndefined();
    });

    it("returns the transcript for a recording in the user's program", async () => {
      const ctx = createContext({
        db: createRecordingDatabase({ id: "rec-1", programId: "program-a", title: "Week one", transcriptText: "hello" }),
        programIds: ["program-a"],
      });

      const result = JSON.parse(await executeTool("get_recording_details", { recording_id: "rec-1" }, ctx));

      expect(result.transcript).toBe("hello");
    });
  });

  describe("allowedTools gate", () => {
    it("refuses a tool the caller did not offer, even if the model asks for it", async () => {
      const { db, captured } = createSelectDatabase([{ id: "rec-1", title: "Leaked", durationSeconds: 1, recordedAt: null, programId: "program-b" }]);
      const ctx = createContext({
        db,
        programIds: ["program-a"],
        allowedTools: new Set(["get_user_context", "get_program_info"]),
      });

      const result = JSON.parse(await executeTool("list_recordings", {}, ctx));

      expect(result.error).toBe("Tool not available: list_recordings");
      expect(captured).toEqual([]);
    });

    it("allows a tool that is in the offered set", async () => {
      const { db } = createSelectDatabase([]);
      const ctx = createContext({
        db,
        programIds: ["program-a"],
        allowedTools: new Set(TOOL_DEFINITIONS.map((t) => t.function.name)),
      });

      const result = JSON.parse(await executeTool("list_recordings", {}, ctx));

      expect(result.error).toBeUndefined();
      expect(result.recordings).toEqual([]);
    });
  });
});
