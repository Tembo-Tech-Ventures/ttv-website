import type { APIContext } from "astro";
import { channelDatabase, ORIGIN, VIEWER } from "@/lib/channels/test-support";
import { ROUTES } from "@/lib/platform/contracts";
import type { CapabilityCase } from "@/lib/platform/server/capabilities.fixtures";
import { MINUTE_MS } from "./clock";
import { meetingRequest, type MeetingOperation, type MeetingRequestOptions } from "./http";
import { FakeCallProvider } from "./provider";
import { LIMIT_MINUTES } from "./calls";
import type { MeetingPurpose, MeetingRecordingPolicy, MeetingState } from "./rules";

/**
 * The channel test database (every migration, cohorts A and B, Wanjiku the caller with the fixture's
 * roles; Otieno and Achieng in cohort A, Faith its TA) plus: Amina (ADMIN), David (a global MENTOR),
 * Amani (INSTITUTION only), Joseph (cohort A's invited mentor), Kevin (cohort B), and `extra`
 * further cohort A members (synthetic-member-1 …). Everyone has agreed to the code of conduct, the
 * caller too unless `conduct: false`. Calls go through meetingRequest with a fake provider and a
 * clock the test moves (`at`, `advance`).
 */
export const T0 = Date.parse("2026-11-24T08:00:00Z");
export const PEOPLE = {
  wanjiku: VIEWER, otieno: "synthetic-otieno", achieng: "synthetic-achieng", faith: "synthetic-faith",
  amina: "synthetic-amina", david: "synthetic-david", amani: "synthetic-amani", joseph: "synthetic-joseph", kevin: "synthetic-kevin",
} as const;
const ADDED: Record<string, { name: string; roles?: string[] }> = {
  [PEOPLE.amina]: { name: "Amina Hassan", roles: ["ADMIN"] },
  [PEOPLE.david]: { name: "David Kamau", roles: ["MENTOR"] },
  [PEOPLE.amani]: { name: "Amani Wekesa", roles: ["INSTITUTION"] },
  [PEOPLE.joseph]: { name: "Joseph Mutua" },
  [PEOPLE.kevin]: { name: "Kevin Omondi" },
};
export const member = (n: number) => `synthetic-member-${n}`;

export function meetingDatabase(fixture: Partial<CapabilityCase> & { conduct?: boolean; extra?: number } = {}) {
  const s = channelDatabase(fixture);
  const { database } = s;
  const person = (id: string, name: string, roles: string[] = []) => {
    database.prepare('INSERT INTO "user"(id,name,email) VALUES (?,?,?)').run(id, name, `${id}@example.test`);
    database.prepare("INSERT INTO channel_conduct(userId,version,acknowledgedAt) VALUES (?,1,1)").run(id);
    for (const role of roles) {
      database.prepare("INSERT OR IGNORE INTO Roles(id,name) VALUES (?,?)").run(role, role);
      database.prepare("INSERT INTO UserRoles(id,userId,roleId) SELECT ?,?,id FROM Roles WHERE name=?").run(`role-${id}-${role}`, id, role);
    }
  };
  for (const [id, { name, roles }] of Object.entries(ADDED)) person(id, name, roles);
  database.exec(`INSERT INTO programRole(id,userId,programId,name) VALUES ('joseph-mentor','${PEOPLE.joseph}','cohort-a','MENTOR');
    INSERT INTO programApplication(id,userId,programId,status,application) VALUES ('kevin-b','${PEOPLE.kevin}','cohort-b','APPROVED','{}');`);
  for (let n = 1; n <= (fixture.extra ?? 0); n++) {
    person(member(n), `Synthetic Member ${n}`);
    database.prepare("INSERT INTO programApplication(id,userId,programId,status,application) VALUES (?,?,'cohort-a','APPROVED','{}')")
      .run(`member-${n}-a`, member(n));
  }
  if (fixture.conduct !== false) s.agree();

  const provider = new FakeCallProvider();
  let now = T0;
  /** Moves the clock to T0 plus `minutes`, or by `minutes` from where it is. */
  const at = (minutes: number) => { now = T0 + minutes * MINUTE_MS; };
  const advance = (minutes: number) => { now += minutes * MINUTE_MS; };

  /** A direct conversation between two people (the caller and Otieno unless told). Returns its id. */
  let conversations = 0;
  function direct(members: readonly string[] = [VIEWER, PEOPLE.otieno]): string {
    const id = `direct-${++conversations}`;
    database.prepare("INSERT INTO channel(id, kind, slug, name) VALUES (?, 'DIRECT', 'conversation', 'Conversation')").run(id);
    for (const userId of members) database.prepare("INSERT INTO channel_member(channelId, userId) VALUES (?, ?)").run(id, userId);
    return id;
  }

  /** A call written straight to the table (a session in cohort-04 unless told). Returns its id. */
  let calls = 0;
  function meeting(options: {
    channelId?: string; purpose?: MeetingPurpose; state?: MeetingState; openedAt?: number | null; hardEndAt?: number | null;
    recordingPolicy?: MeetingRecordingPolicy; title?: string;
  } = {}): string {
    const id = `meeting-${++calls}`;
    const purpose = options.purpose ?? "SESSION";
    const state = options.state ?? "SCHEDULED";
    const openedAt = options.openedAt ?? (state === "LIVE" ? now : null);
    database.prepare(`INSERT INTO meeting (id, channelId, purpose, title, scheduledStartAt, bookedMinutes, limitMinutes, recordingPolicy,
        state, openedAt, hardEndAt, journeyVersion, providerMeetingId, createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      id, options.channelId ?? s.channel("cohort-04"), purpose, options.title ?? "Week 9: payments and retries", T0,
      Math.min(60, LIMIT_MINUTES[purpose]), LIMIT_MINUTES[purpose],
      options.recordingPolicy ?? "ALWAYS", state, openedAt,
      options.hardEndAt === undefined ? (openedAt !== null && purpose !== "CHECKIN" ? openedAt + LIMIT_MINUTES[purpose] * MINUTE_MS : null) : options.hardEndAt,
      purpose === "CHECKIN" ? 1 : null, state === "LIVE" ? `fake-meeting-${id}` : null, T0 - MINUTE_MS, T0 - MINUTE_MS,
    );
    return id;
  }

  /** Calls a meeting API as the caller (or `user`), same-origin unless told otherwise, at the test's clock. */
  async function call(operation: MeetingOperation, options: {
    id?: string; body?: unknown; user?: string | null; origin?: string | null; locals?: Partial<App.Locals>;
    env?: Partial<Parameters<typeof meetingRequest>[2]>;
  } & MeetingRequestOptions = {}) {
    const { method } = ROUTES[operation];
    const headers = new Headers();
    const origin = options.origin === undefined ? ORIGIN : options.origin;
    if (origin) headers.set("Origin", origin);
    const body = options.body === undefined ? (method === "GET" ? undefined : {}) : options.body;
    const request = new Request(`${ORIGIN}/api/meetings`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const user = options.user === undefined ? VIEWER : options.user;
    const locals = { user: user === null ? null : { id: user }, personalAccessToken: null, ...options.locals } as App.Locals;
    const context = { request, locals, params: options.id === undefined ? {} : { id: options.id } } as Pick<APIContext, "request" | "locals" | "params">;
    const response = await meetingRequest(operation, context, { DB: s.d1, PLATFORM_FLAGS_OVERRIDE: "all", ...options.env } as Parameters<typeof meetingRequest>[2],
      { now: () => now, provider, ...options });
    return { status: response.status, body: await response.json() as Record<string, unknown>, response };
  }

  /** The seats of a call, as the table holds them. */
  const seats = (meetingId: string) => database.prepare("SELECT userId, role, state, providerParticipantId FROM meeting_seat WHERE meetingId = ? ORDER BY userId")
    .all(meetingId) as { userId: string; role: string; state: string; providerParticipantId: string | null }[];
  const row = (meetingId: string) => database.prepare("SELECT * FROM meeting WHERE id = ?").get(meetingId) as Record<string, unknown>;

  return { ...s, provider, at, advance, now: () => now, direct, meeting, call, seats, row };
}
export type MeetingFixture = ReturnType<typeof meetingDatabase>;
