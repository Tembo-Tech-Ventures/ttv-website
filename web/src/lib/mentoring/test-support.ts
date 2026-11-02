import type { APIContext } from "astro";
import { channelDatabase, ORIGIN, VIEWER } from "@/lib/channels/test-support";
import { ROUTES, type UpdateMentorAvailability } from "@/lib/platform/contracts";
import type { CapabilityCase } from "@/lib/platform/server/capabilities.fixtures";
import { mentoringRequest, type MentoringOperation, type MentoringRequestOptions } from "./http";

/**
 * The channel test database (every migration, two cohorts, Wanjiku the caller) plus mentors:
 * David (MENTOR, 2 spots a month), Mercy (MENTOR, 1 spot, written reviews only), Joseph (MENTOR and
 * INSTITUTION, 3 spots), Peter (MENTOR, paused), Kevin (a saved profile but no MENTOR role), Amani
 * (INSTITUTION only) and Amina (ADMIN). Everyone has agreed to the code of conduct, the caller too
 * unless `conduct: false`. 2026-11-15 12:00 in Nairobi is "now" unless a call says otherwise.
 */
export const NOW = Date.parse("2026-11-15T09:00:00Z");
export const PEOPLE = {
  david: "synthetic-david", mercy: "synthetic-mercy", joseph: "synthetic-joseph", peter: "synthetic-peter",
  kevin: "synthetic-kevin", amani: "synthetic-amani", amina: "synthetic-amina",
} as const;
const NAMES: Record<string, string> = {
  [PEOPLE.david]: "David Kamau", [PEOPLE.mercy]: "Mercy Wambui", [PEOPLE.joseph]: "Joseph Mutua", [PEOPLE.peter]: "Peter Njoroge",
  [PEOPLE.kevin]: "Kevin Omondi", [PEOPLE.amani]: "Amani Wekesa", [PEOPLE.amina]: "Amina Hassan",
};
const ROLES: Record<string, string[]> = {
  [PEOPLE.david]: ["MENTOR"], [PEOPLE.mercy]: ["MENTOR"], [PEOPLE.joseph]: ["MENTOR", "INSTITUTION"], [PEOPLE.peter]: ["MENTOR"],
  [PEOPLE.amani]: ["INSTITUTION"], [PEOPLE.amina]: ["ADMIN"],
};
const PROFILES: Record<string, UpdateMentorAvailability> = {
  [PEOPLE.david]: { headline: "Backend engineer · fintech", monthlyCapacity: 2, areas: ["Code review", "API design"],
    formats: ["WRITTEN_REVIEW", "CALL_30_MIN", "QUICK_QUESTION"], bio: "Reviews APIs and data models.", paused: false },
  [PEOPLE.mercy]: { headline: "Product designer", monthlyCapacity: 1, areas: ["Portfolios"], formats: ["WRITTEN_REVIEW"],
    bio: "Portfolio reviews.", paused: false },
  [PEOPLE.joseph]: { headline: "Engineering manager", monthlyCapacity: 3, areas: ["Career"], formats: ["CALL_30_MIN"],
    bio: "Career conversations.", paused: false },
  [PEOPLE.peter]: { headline: "Data engineer", monthlyCapacity: 2, areas: ["Data"], formats: ["WRITTEN_REVIEW"], bio: "", paused: true },
  [PEOPLE.kevin]: { headline: "Former mentor", monthlyCapacity: 2, areas: ["Code review"], formats: ["WRITTEN_REVIEW"], bio: "", paused: false },
};

export function mentoringDatabase(fixture: Partial<CapabilityCase> & { conduct?: boolean } = {}) {
  const s = channelDatabase(fixture);
  const { database } = s;
  for (const [id, name] of Object.entries(NAMES)) {
    database.prepare('INSERT INTO "user"(id,name,email) VALUES (?,?,?)').run(id, name, `${id}@example.test`);
    database.prepare("INSERT INTO channel_conduct(userId,version,acknowledgedAt) VALUES (?,1,1)").run(id);
    for (const role of ROLES[id] ?? []) {
      database.prepare("INSERT OR IGNORE INTO Roles(id,name) VALUES (?,?)").run(role, role);
      database.prepare("INSERT INTO UserRoles(id,userId,roleId) SELECT ?,?,id FROM Roles WHERE name=?").run(`role-${id}-${role}`, id, role);
    }
  }
  for (const [id, profile] of Object.entries(PROFILES)) {
    database.prepare(`INSERT INTO mentor_profile(userId,headline,bio,areas,formats,monthlyCapacity,paused,createdAt,updatedAt)
      VALUES (?,?,?,?,?,?,?,1,1)`).run(id, profile.headline, profile.bio, JSON.stringify(profile.areas), JSON.stringify(profile.formats),
      profile.monthlyCapacity, profile.paused ? 1 : 0);
  }
  if (fixture.conduct !== false) s.agree();

  /** A published project of the caller's (or `owner`'s) at `version`. */
  function project(id: string, { owner = VIEWER, version = 1, visibility = "institution", title = "Bus fare splitter" } = {}) {
    database.prepare(`INSERT INTO communityJourney (id, userId, title, description, evidenceUrl, occurredAt, visibility, version, updatedAt)
      VALUES (?, ?, ?, 'Splits matatu fares and settles through M-Pesa.', 'https://example.test/fare-split', '2026-10', ?, ?, 1)`)
      .run(id, owner, title, visibility, version);
    return { type: "project" as const, journeyId: id, version };
  }

  /** Calls a mentoring API as the caller (or `user`), same-origin unless told otherwise. Work after the response waits in `deferred`. */
  const deferred: (() => Promise<void>)[] = [];
  async function afterResponse() {
    for (let task = deferred.shift(); task; task = deferred.shift()) await task();
  }
  async function call(operation: MentoringOperation, options: {
    id?: string; query?: string; body?: unknown; user?: string | null; origin?: string | null; locals?: Partial<App.Locals>;
    env?: Partial<Parameters<typeof mentoringRequest>[2]>;
  } & MentoringRequestOptions = {}) {
    const { method } = ROUTES[operation];
    const headers = new Headers();
    const origin = options.origin === undefined ? ORIGIN : options.origin;
    if (origin) headers.set("Origin", origin);
    const request = new Request(`${ORIGIN}/api/x${options.query ?? ""}`, {
      method, headers, body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
    const user = options.user === undefined ? VIEWER : options.user;
    const locals = { user: user === null ? null : { id: user }, personalAccessToken: null, ...options.locals } as App.Locals;
    const context = { request, locals, params: options.id === undefined ? {} : { id: options.id } } as Pick<APIContext, "request" | "locals" | "params">;
    const response = await mentoringRequest(operation, context, { DB: s.d1, PLATFORM_FLAGS_OVERRIDE: "all", ...options.env } as Parameters<typeof mentoringRequest>[2],
      { now: () => NOW, defer: (task) => deferred.push(task), ...options });
    return { status: response.status, body: await response.json() as unknown, response };
  }

  /** A request from the caller (or `user`) to `mentorId`, through the API. Returns its id. */
  async function ask(mentorId: string = PEOPLE.david, options: { user?: string; note?: string; format?: string; project?: unknown; now?: number } = {}) {
    const response = await call("createMentorRequest", {
      user: options.user, ...options.now === undefined ? {} : { now: () => options.now! },
      body: { mentorId, note: options.note ?? "Could you check how I handle a payment callback that arrives twice?",
        project: options.project ?? null, format: options.format ?? "WRITTEN_REVIEW" },
    });
    if (response.status !== 201) throw new Error(`ask failed: ${response.status} ${JSON.stringify(response.body)}`);
    return (response.body as { id: string }).id;
  }

  return { ...s, channelCall: s.call, project, call, ask, deferred, afterResponse };
}
export type MentoringFixture = ReturnType<typeof mentoringDatabase>;
