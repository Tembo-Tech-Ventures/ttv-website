import { describe, expect, it, vi } from "vitest";
import { SQLiteSyncDialect } from "drizzle-orm/sqlite-core";
import type { SQL } from "drizzle-orm";
import type { Database } from "@/lib/db/schema";
import type { PlatformCapabilities } from "@/lib/platform/server/capabilities";
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

function caps(overrides: Partial<PlatformCapabilities> = {}): PlatformCapabilities {
  return { spaces: ["community", "profile"], cohortIds: [], mentorCohortIds: [], teachingCohortIds: [], isMentor: false, isInstitution: false, isAdmin: false, ...overrides };
}

function createContext(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    env: {} as Env,
    db: createSelectDatabase().db,
    userId: "user-1",
    userName: "Amina",
    capabilities: caps(),
    sources: [],
    ...overrides,
  };
}

/** A recording row as Drizzle reads it: a cohort's, visible, its transcript complete. */
const cohortRecording = (overrides: Record<string, unknown> = {}) => ({
  id: "rec-1", programId: "program-a", accessScope: "COHORT", deletedAt: null, hiddenAt: null,
  processingStatus: "complete", title: "Week one", transcriptText: "hello", ...overrides,
});

describe("chat tool access boundaries", () => {
  describe("list_recordings", () => {
    it("returns nothing for a non-admin with no accessible programs", async () => {
      const { db, captured } = createSelectDatabase([
        { id: "rec-other-program", title: "Some other cohort", durationSeconds: 60, recordedAt: null, programId: "program-b" },
      ]);
      const ctx = createContext({ db });

      const result = JSON.parse(await executeTool("list_recordings", {}, ctx));

      expect(result).toEqual({ recordings: [] });
      // It must not fall through to an unconstrained query at all.
      expect(captured).toEqual([]);
    });

    it("constrains the query to the user's cohorts' recordings, complete ones only", async () => {
      const { db, captured } = createSelectDatabase([]);
      const ctx = createContext({ db, capabilities: caps({ cohortIds: ["program-a"] }) });

      await executeTool("list_recordings", {}, ctx);

      expect(captured).toHaveLength(1);
      expect(captured[0]).toContain("recording.accessScope = 'COHORT' AND recording.programId IN ('program-a')");
      expect(captured[0]).toContain("recording.processingStatus = 'complete'");
    });

    it("gives an admin every cohort's recordings and those with no cohort, never a deleted one", async () => {
      const { db, captured } = createSelectDatabase([]);
      const ctx = createContext({ db, capabilities: caps({ isAdmin: true }) });

      await executeTool("list_recordings", {}, ctx);

      expect(captured).toHaveLength(1);
      expect(captured[0]).toContain("recording.accessScope IN ('COHORT', 'ADMIN_ONLY')");
      expect(captured[0]).toContain("recording.deletedAt IS NULL");
      expect(captured[0]).not.toContain("programId IN");
    });
  });

  describe("get_recording_details", () => {
    function createRecordingDatabase(recording: unknown) {
      return {
        query: { recording: { findFirst: vi.fn().mockResolvedValue(recording) } },
      } as unknown as Database;
    }

    const details = async (recording: unknown, capabilities = caps({ cohortIds: ["program-a"] })) =>
      JSON.parse(await executeTool("get_recording_details", { recording_id: "rec-1" },
        createContext({ db: createRecordingDatabase(recording), capabilities })));

    it("refuses a recording belonging to a program the user cannot access, as if it were missing", async () => {
      const result = await details(cohortRecording({ programId: "program-b", transcriptText: "secret" }));

      expect(result).toEqual({ error: "Recording not found" });
      expect(await details(undefined)).toEqual(result);
    });

    it("refuses a recording with no cohort to everyone but admins", async () => {
      const noCohort = cohortRecording({ programId: null, accessScope: "ADMIN_ONLY", transcriptText: "secret" });

      expect(await details(noCohort)).toEqual({ error: "Recording not found" });
      expect(await details(noCohort, caps({ cohortIds: ["program-a"], teachingCohortIds: ["program-a"] }))).toEqual({ error: "Recording not found" });
      expect((await details(noCohort, caps({ isAdmin: true }))).transcript).toBe("secret");
    });

    it("returns the transcript for a recording in the user's program, once it is complete", async () => {
      expect((await details(cohortRecording())).transcript).toBe("hello");
      expect(await details(cohortRecording({ processingStatus: "transcribing" }))).toMatchObject({ id: "rec-1", transcript: null });
    });

    it("traces a recording whose transcript it returned, so the saved answer can be checked again later", async () => {
      const read = new Set<string>();
      const capabilities = caps({ cohortIds: ["program-a"] });
      const run = (recording: unknown) => executeTool("get_recording_details", { recording_id: "rec-1" },
        createContext({ db: createRecordingDatabase(recording), capabilities, read }));
      await run(cohortRecording({ processingStatus: "transcribing" }));
      await run(cohortRecording({ programId: "program-b" }));
      expect(read).toEqual(new Set());
      await run(cohortRecording());
      expect(read).toEqual(new Set(["rec-1"]));
    });
  });

  describe("get_program_info", () => {
    function programDatabase() {
      const program = {
        id: "cohort-a", name: "Cohort A", description: "", applicationsOpen: false, startDate: null, endDate: null,
        curriculum: null,
        programRoles: [
          { name: "MENTOR", user: { name: "Invited Mentor" } },
          { name: "TA", user: { name: "Faith Njeri" } },
          { name: "INSTRUCTOR", user: { name: "Otieno Ouma" } },
        ],
      };
      return { query: { program: { findMany: vi.fn().mockResolvedValue([program]) } } } as unknown as Database;
    }
    const staffFor = async (overrides: Partial<ToolContext>) =>
      JSON.parse(await executeTool("get_program_info", { program_id: "cohort-a" }, createContext({ db: programDatabase(), ...overrides })))
        .programs[0].staff.map((member: { role: string }) => member.role);

    it("never names a cohort's invited mentors to someone outside that cohort", async () => {
      expect(await staffFor({ capabilities: caps() })).toEqual(["TA", "INSTRUCTOR"]);
      expect(await staffFor({ capabilities: caps({ cohortIds: ["cohort-b"] }) })).toEqual(["TA", "INSTRUCTOR"]);
    });

    it("names them to the cohort's own members and to admins", async () => {
      expect(await staffFor({ capabilities: caps({ cohortIds: ["cohort-a"] }) })).toEqual(["MENTOR", "TA", "INSTRUCTOR"]);
      expect(await staffFor({ capabilities: caps({ isAdmin: true }) })).toEqual(["MENTOR", "TA", "INSTRUCTOR"]);
    });
  });

  describe("allowedTools gate", () => {
    it("refuses a tool the caller did not offer, even if the model asks for it", async () => {
      const { db, captured } = createSelectDatabase([{ id: "rec-1", title: "Leaked", durationSeconds: 1, recordedAt: null, programId: "program-b" }]);
      const ctx = createContext({
        db,
        capabilities: caps({ cohortIds: ["program-a"] }),
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
        capabilities: caps({ cohortIds: ["program-a"] }),
        allowedTools: new Set(TOOL_DEFINITIONS.map((t) => t.function.name)),
      });

      const result = JSON.parse(await executeTool("list_recordings", {}, ctx));

      expect(result.error).toBeUndefined();
      expect(result.recordings).toEqual([]);
    });
  });
});

describe("search_transcripts across one answer (QA3-08)", () => {
  /** A transcript search whose index always finds the same two passages of one recording. */
  function searching() {
    const rows = [
      { id: "seg-1", recordingId: "rec-1", startTime: 0, endTime: 9, text: "Cursor pagination", recordingTitle: "Week 5", recordingProgramId: "program-a" },
      { id: "seg-2", recordingId: "rec-1", startTime: 40, endTime: 49, text: "Offset pagination", recordingTitle: "Week 5", recordingProgramId: "program-a" },
    ];
    const orderBy = vi.fn().mockResolvedValue(rows);
    const chain = { from: () => chain, innerJoin: () => chain, where: () => ({ orderBy }) };
    const env = {
      AI: { run: vi.fn().mockResolvedValue({ data: [[0.1, 0.2]] }) },
      VECTORIZE: { query: vi.fn().mockResolvedValue({ matches: rows.map((row) => ({ metadata: { segment_id: row.id, recording_id: row.recordingId, start_time: row.startTime, end_time: row.endTime } })) }) },
    } as unknown as Env;
    return createContext({ env, db: { select: () => chain } as unknown as Database, capabilities: caps({ cohortIds: ["program-a"] }) });
  }

  it("lists a passage once however often Tembo searches, giving it back under its first number", async () => {
    const ctx = searching();
    const first = JSON.parse(await executeTool("search_transcripts", { query: "pagination" }, ctx)) as { results: { sourceNumber: number }[] };
    const again = JSON.parse(await executeTool("search_transcripts", { query: "cursor pagination" }, ctx)) as { results: { sourceNumber: number }[] };
    expect(first.results.map((result) => result.sourceNumber)).toEqual([1, 2]);
    expect(again.results.map((result) => result.sourceNumber)).toEqual([1, 2]);
    expect(ctx.sources.map((source) => [source.sourceNumber, source.startTime])).toEqual([[1, 0], [2, 40]]);
  });
});
