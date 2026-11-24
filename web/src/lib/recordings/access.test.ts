import { readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readMigration } from "@/test/sqlite-d1";
import { CAPABILITY_ROLE_MATRIX } from "@/lib/platform/server/capabilities.fixtures";
import { channelAccessFor, type PlatformCapabilities } from "@/lib/platform/server/capabilities";
import type { ChannelKind } from "@/lib/platform/contracts";
import { DEMO_PREFIX } from "@/lib/staging-demo-policy";
import { RECORDING_ACCESS_SCOPES } from "@/lib/db/schema";
import {
  cohortAudience, cohortAudienceSql, cohortScope, mayReadRecordings, recordingAccessFor, recordingScopeSql,
  type RecordingAccessTarget, type RecordingReach, type RecordingViewer,
} from "./access";

/*
 * The recording access policy's two forms, recordingAccessFor (one recording) and recordingScopeSql
 * (a SQL condition), give the same answer for every kind of viewer and every kind of recording, on
 * SQLite with every migration, for cohort sessions and for everything. cohortAudienceSql equals
 * recordingScopeSql for cohortAudience. A conversation's or the community's recording follows
 * channelAccessFor.
 */
const DEMO_PROGRAM = DEMO_PREFIX + "program";
const PROGRAMS = ["cohort-a", "cohort-b", DEMO_PROGRAM, null] as const;
const USER = "synthetic-wanjiku";
const DEMO_USER = DEMO_PREFIX + "member-cohort";
/** A direct conversation between two people, neither of them USER; one is an admin. */
const MEMBER = "synthetic-otieno";
const ADMIN_MEMBER = "synthetic-amina";
const REACHES: RecordingReach[] = ["sessions", "everything"];

interface Row extends RecordingAccessTarget { id: string; channelId: string | null }
let database: DatabaseSync;
let rows: Row[];
/** The channels a recording may name: a conversation, a community channel, a cohort channel, none. */
let channels: Record<"conversation" | "community" | "cohort", { id: string; kind: ChannelKind }>;
const members = new Set<string>();

beforeAll(() => {
  database = new DatabaseSync(":memory:");
  database.exec("PRAGMA foreign_keys = ON");
  for (const file of readdirSync(new URL("../db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    database.exec(readMigration(file));
  }
  database.exec(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
    INSERT INTO program(id,name,description,curriculumId) VALUES ('cohort-a','A','Test','curriculum'),('cohort-b','B','Test','curriculum'),
      ('${DEMO_PROGRAM}','Demo','Test','curriculum');`);
  database.exec(`INSERT INTO user(id,name,email) VALUES ('${MEMBER}','Otieno Ouma','otieno@example.test'),('${ADMIN_MEMBER}','Amina Hassan','amina@example.test');
    INSERT INTO channel(id,kind,slug,name) VALUES ('conversation','DIRECT','dm','Otieno and Amina');
    INSERT INTO channel_member(channelId,userId) VALUES ('conversation','${MEMBER}'),('conversation','${ADMIN_MEMBER}');`);
  for (const userId of [MEMBER, ADMIN_MEMBER]) members.add(`conversation:${userId}`);
  const seeded = (seedKey: string) => (database.prepare("SELECT id, kind FROM channel WHERE seedKey = ?").get(seedKey) as { id: string; kind: ChannelKind });
  channels = { conversation: { id: "conversation", kind: "DIRECT" }, community: seeded("community:help"), cohort: seeded("cohort:cohort-a:main") };
  // Every scope, cohort, channel, deletion and hiding: inserted, then set, so the cohort triggers
  // can't normalise the odd ones away (an admins-only recording that still names a cohort).
  const insert = database.prepare("INSERT INTO recording(id,programId,title) VALUES (?,?,'Session')");
  const set = database.prepare("UPDATE recording SET accessScope = ?, channelId = ?, deletedAt = ?, hiddenAt = ? WHERE id = ?");
  for (const scope of RECORDING_ACCESS_SCOPES) for (const programId of PROGRAMS) for (const deleted of [null, 1]) for (const hidden of [null, 1]) {
    for (const channel of [null, ...Object.keys(channels) as (keyof typeof channels)[]]) {
      const id = [scope, programId ?? "none", deleted ? "deleted" : "", hidden ? "hidden" : "", channel ?? ""].join(":");
      insert.run(id, programId);
      set.run(scope, channel && channels[channel].id, deleted, hidden, id);
    }
  }
  rows = database.prepare("SELECT id, programId, accessScope, channelId, deletedAt, hiddenAt FROM recording ORDER BY id").all() as unknown as Row[];
});
afterAll(() => database.close());

const COMMUNITY_SPACES: PlatformCapabilities["spaces"] = ["community", "profile"];
const viewers: { name: string; viewer: RecordingViewer; userId: string | null }[] = [
  ...CAPABILITY_ROLE_MATRIX.map(({ name, expected }) => ({ name, viewer: expected, userId: USER })),
  { name: "demo member", viewer: { cohortIds: [DEMO_PROGRAM], teachingCohortIds: [], isAdmin: false, spaces: COMMUNITY_SPACES }, userId: DEMO_USER },
  { name: "demo admin", viewer: { cohortIds: [], teachingCohortIds: [], isAdmin: true, spaces: COMMUNITY_SPACES }, userId: DEMO_USER },
  { name: "demo instructor", viewer: { cohortIds: [DEMO_PROGRAM], teachingCohortIds: [DEMO_PROGRAM], isAdmin: false }, userId: DEMO_USER },
  { name: "conversation member", viewer: { cohortIds: [], teachingCohortIds: [], isAdmin: false, spaces: COMMUNITY_SPACES }, userId: MEMBER },
  { name: "conversation member who is an admin", viewer: { cohortIds: [], teachingCohortIds: [], isAdmin: true, spaces: ["cohort", "community", "admin", "profile"] }, userId: ADMIN_MEMBER },
  { name: "conversation member with no spaces given", viewer: { cohortIds: [], teachingCohortIds: [], isAdmin: false }, userId: MEMBER },
  ...["cohort-a", "cohort-b", DEMO_PROGRAM].map((programId) => ({ name: `audience of ${programId}`, viewer: cohortAudience(programId), userId: null })),
];

const bySql = (condition: string, ...values: string[]) =>
  (database.prepare(`SELECT id FROM recording r WHERE ${condition} ORDER BY id`).all(...values) as { id: string }[]).map(({ id }) => id);
/** The rows of one scope, cohort, deletion and hiding (`COHORT:cohort-a::hidden`), whatever channel they name. */
const variants = (base: string) => rows.filter(({ id }) => id.split(":").slice(0, 4).join(":") === base).map(({ id }) => id);
/** The recording's channel as a caller reads it for this person: its kind, and their membership. */
const channelFacts = (row: Row, userId: string | null) => {
  const channel = Object.values(channels).find(({ id }) => id === row.channelId);
  return channel ? { ...channel, isMember: members.has(`${channel.id}:${userId}`) } : null;
};
const byPolicy = (viewer: RecordingViewer, userId: string | null, reach: RecordingReach = "sessions") =>
  rows.filter((row) => recordingAccessFor(viewer, row, { userId, reach, channel: channelFacts(row, userId) })).map(({ id }) => id);

describe("the recording access policy", () => {
  it.each(viewers.flatMap((v) => REACHES.map((reach) => ({ ...v, reach }))))("$name, $reach: one recording and the SQL condition agree", ({ viewer, userId, reach }) => {
    expect(bySql(recordingScopeSql(viewer, userId, "r", { reach }))).toEqual(byPolicy(viewer, userId, reach));
    // The default alias is the table's own name.
    expect((database.prepare(`SELECT id FROM recording WHERE ${recordingScopeSql(viewer, userId, undefined, { reach })} ORDER BY id`).all() as { id: string }[])
      .map(({ id }) => id)).toEqual(byPolicy(viewer, userId, reach));
  });

  it("reads cohort sessions only unless a path asks for everything", () => {
    for (const { viewer, userId } of viewers) {
      expect(bySql(recordingScopeSql(viewer, userId, "r"))).toEqual(bySql(recordingScopeSql(viewer, userId, "r", { reach: "sessions" })));
      expect(byPolicy(viewer, userId, "sessions").filter((id) => /^(DIRECT|COMMUNITY):/.test(id))).toEqual([]);
      expect(byPolicy(viewer, userId, "everything").filter((id) => /^(COHORT|ADMIN_ONLY):/.test(id))).toEqual(byPolicy(viewer, userId, "sessions"));
    }
  });

  it("lets a conversation's two members, and nobody else, watch its recording: admins neither", () => {
    const direct = (userId: string | null, viewer: RecordingViewer) => byPolicy(viewer, userId, "everything").filter((id) => id.startsWith("DIRECT:"));
    const member = viewers.find(({ name }) => name === "conversation member")!.viewer;
    const adminMember = viewers.find(({ name }) => name === "conversation member who is an admin")!.viewer;
    // Its own conversation only, never deleted; hidden only for an admin.
    expect(direct(MEMBER, member)).toEqual(rows.filter(({ id }) => /^DIRECT:[^:]+:::conversation$/.test(id)).map(({ id }) => id));
    expect(direct(ADMIN_MEMBER, adminMember)).toEqual(rows.filter(({ id }) => /^DIRECT:[^:]+::(hidden)?:conversation$/.test(id)).map(({ id }) => id));
    // Every other person, admins included, and every cohort audience: none.
    for (const { name, viewer, userId } of viewers.filter((other) => other.userId !== MEMBER && other.userId !== ADMIN_MEMBER)) {
      expect({ name, sees: direct(userId, viewer) }).toEqual({ name, sees: [] });
    }
  });

  it("lets whoever can read a community channel watch its recording, and only a community channel's", () => {
    for (const { name, viewer, userId } of viewers) {
      const seen = byPolicy(viewer, userId, "everything").filter((id) => id.startsWith("COMMUNITY:"));
      const reads = userId !== null && viewer.spaces?.includes("community") === true;
      const expected = rows.filter(({ id, programId }) => id.startsWith("COMMUNITY:") && id.endsWith(":community") && !id.includes("deleted")
        && (viewer.isAdmin || !id.includes("hidden") || (programId !== null && viewer.teachingCohortIds.includes(programId)))
        && (userId !== DEMO_USER || programId === DEMO_PROGRAM));
      expect({ name, seen }).toEqual({ name, seen: reads ? expected.map(({ id }) => id) : [] });
    }
  });

  it("agrees with channelAccessFor on who reads a conversation's or a community channel's recording", () => {
    const people = [...CAPABILITY_ROLE_MATRIX.map(({ expected }) => expected), viewers.find(({ name }) => name === "conversation member who is an admin")!.viewer as PlatformCapabilities];
    for (const capabilities of people) for (const userId of [USER, MEMBER]) for (const key of ["conversation", "community"] as const) {
      const channel = channels[key];
      const isMember = members.has(`${channel.id}:${userId}`);
      const recording = { programId: null, accessScope: channel.kind, channelId: channel.id, deletedAt: null, hiddenAt: null };
      expect(recordingAccessFor(capabilities, recording, { userId, reach: "everything", channel: { ...channel, isMember } }))
        .toBe(channelAccessFor(capabilities, { kind: channel.kind, programId: null, postingPolicy: "ALL", archivedAt: null }, { isMember }).canRead);
    }
  });

  it("admits nobody to a channel's recording when the channel given is another, or none", () => {
    const viewer = viewers.find(({ name }) => name === "conversation member who is an admin")!.viewer;
    const recording = { programId: null, accessScope: "DIRECT", channelId: "conversation", deletedAt: null, hiddenAt: null };
    const context = { userId: ADMIN_MEMBER, reach: "everything" as const };
    expect(recordingAccessFor(viewer, recording, { ...context, channel: { id: "conversation", kind: "DIRECT", isMember: true } })).toBe(true);
    expect(recordingAccessFor(viewer, recording, { ...context, channel: { id: "another", kind: "DIRECT", isMember: true } })).toBe(false);
    expect(recordingAccessFor(viewer, recording, context)).toBe(false);
    expect(recordingAccessFor(viewer, { ...recording, channelId: undefined }, { ...context, channel: { id: "conversation", kind: "DIRECT", isMember: true } })).toBe(false);
    expect(recordingAccessFor(viewer, { ...recording, accessScope: "COMMUNITY" }, { ...context, channel: { id: "conversation", kind: "DIRECT", isMember: true } })).toBe(false);
  });

  it("names the scope a cohort, or no cohort, gives a recording", () => {
    expect(cohortScope("cohort-a")).toBe("COHORT");
    expect(cohortScope(null)).toBe("ADMIN_ONLY");
  });

  it.each(["cohort-a", "cohort-b", DEMO_PROGRAM])("a cohort channel's audience (%s) is the same rule with the cohort as a parameter", (programId) => {
    expect(bySql(cohortAudienceSql("r", "?1"), programId)).toEqual(byPolicy(cohortAudience(programId), null));
    expect(bySql(cohortAudienceSql("r", "?1"), programId)).toEqual(variants(`COHORT:${programId}::`));
  });

  it("follows the scope table", () => {
    const sees = (viewer: RecordingViewer, userId: string | null = USER) => byPolicy(viewer, userId);
    const student = { cohortIds: ["cohort-a"], teachingCohortIds: [], isAdmin: false };
    const host = { ...student, teachingCohortIds: ["cohort-a"] };
    const admin = { cohortIds: [], teachingCohortIds: [], isAdmin: true };
    // COHORT: that cohort's people. Never deleted, never hidden from them.
    expect(sees(student)).toEqual(variants("COHORT:cohort-a::"));
    // Hidden: also the cohort's hosts.
    expect(sees(host)).toEqual([...variants("COHORT:cohort-a::"), ...variants("COHORT:cohort-a::hidden")]);
    // Admins: every cohort's, hidden ones and those with no cohort; never a deleted one, a conversation's or the community's.
    expect(sees(admin)).toEqual(rows.filter(({ id }) => /^(COHORT|ADMIN_ONLY):/.test(id) && !id.includes("deleted")).map(({ id }) => id));
    for (const { viewer, userId } of viewers) {
      const seen = sees(viewer, userId);
      expect(seen.filter((id) => id.includes("deleted") || /^(DIRECT|COMMUNITY):/.test(id))).toEqual([]);
      if (!viewer.isAdmin) expect(seen.filter((id) => id.startsWith("ADMIN_ONLY:") || id.startsWith("COHORT:none"))).toEqual([]);
    }
  });

  it("keeps a demo identity to the demo cohort, whatever its roles", () => {
    for (const viewer of [{ cohortIds: ["cohort-a", DEMO_PROGRAM], teachingCohortIds: [], isAdmin: true }, cohortAudience("cohort-a")]) {
      expect(byPolicy(viewer, DEMO_USER).every((id) => id.includes(`:${DEMO_PROGRAM}:`))).toBe(true);
      expect(bySql(recordingScopeSql(viewer, DEMO_USER, "r"))).toEqual(byPolicy(viewer, DEMO_USER));
    }
  });

  it("writes cohorts as quoted literals that no cohort id can break out of", () => {
    const viewer = { cohortIds: ["o'brien", "x') OR 1=1 --"], teachingCohortIds: ["x' OR '1'='1"], isAdmin: false };
    expect(bySql(recordingScopeSql(viewer, USER, "r"))).toEqual([]);
    expect(() => recordingScopeSql({ ...viewer, cohortIds: ["a\0b"] }, USER)).toThrow("NUL");
  });

  it("reads nothing for someone it can admit to no recording", () => {
    expect(mayReadRecordings({ cohortIds: [], teachingCohortIds: [], isAdmin: false })).toBe(false);
    expect(mayReadRecordings({ cohortIds: ["cohort-a"], teachingCohortIds: [], isAdmin: false })).toBe(true);
    expect(mayReadRecordings({ cohortIds: [], teachingCohortIds: [], isAdmin: true })).toBe(true);
    for (const { viewer, userId } of viewers) {
      if (!mayReadRecordings(viewer)) expect(byPolicy(viewer, userId)).toEqual([]);
    }
  });

  it("treats a raw D1 row's numbers like Drizzle's dates", () => {
    const viewer = cohortAudience("cohort-a");
    const row = { programId: "cohort-a", accessScope: "COHORT", deletedAt: null, hiddenAt: null };
    expect(recordingAccessFor(viewer, row, { userId: null })).toBe(true);
    expect(recordingAccessFor(viewer, { ...row, hiddenAt: 0 }, { userId: null })).toBe(false);
    expect(recordingAccessFor(viewer, { ...row, deletedAt: new Date(0) }, { userId: null })).toBe(false);
    expect(recordingAccessFor(viewer, { ...row, accessScope: "PUBLIC" }, { userId: null })).toBe(false);
  });
});
