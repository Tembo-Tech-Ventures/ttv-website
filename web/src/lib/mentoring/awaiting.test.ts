import { afterEach, describe, expect, it } from "vitest";
import { communityActor } from "@/lib/community/actor";
import { handleCommunityRequest } from "@/lib/community/http";
import { DEMO_PERSONAS } from "@/lib/staging-demo-policy";
import { createSqliteD1, MINIMAL_AUTH_SCHEMA, readMigration } from "@/test/sqlite-d1";
import { awaitingConfirmation, type AwaitingConfirmationContext } from "./awaiting";

type Locals = AwaitingConfirmationContext["locals"];
const databases: { close(): void }[] = [];
afterEach(() => databases.splice(0).forEach((database) => database.close()));

const demoMentor = DEMO_PERSONAS.mentor.userId;
const demoMember = DEMO_PERSONAS["member-cohort"].userId;

/**
 * Members share A, B and E and keep C private; the mentor shares D, their
 * own work. The mentor has confirmed B; a second mentor has confirmed A. A
 * synthetic demo member shares F.
 */
function setup() {
  const { database, db } = createSqliteD1();
  databases.push(database);
  database.exec(MINIMAL_AUTH_SCHEMA);
  database.exec(readMigration("0017_community_discovery.sql"));
  database.exec(readMigration("0018_confirmation_role_snapshot.sql"));
  const users = ["member", "member2", "mentor", "mentor2", "admin", demoMentor, demoMember];
  for (const id of users) database.prepare(`INSERT INTO user (id,name,email) VALUES (?,?,?)`).run(id, id, `${id}@example.test`);
  database.exec(`INSERT INTO Roles (id,name) VALUES ('admin-role','ADMIN')`);
  for (const [userId, role] of [["mentor", "MENTOR"], ["mentor2", "MENTOR"], ["admin", "ADMIN"], [demoMentor, "MENTOR"]]) {
    database.prepare(`INSERT INTO UserRoles (id,userId,roleId) VALUES (?,?,(SELECT id FROM Roles WHERE name=?))`).run(`${userId}-${role}`, userId, role);
  }
  const journey = database.prepare(`INSERT INTO communityJourney (id,userId,title,description,occurredAt,visibility,createdAt) VALUES (?,?,?,?,?,?,?)`);
  for (const [id, userId, visibility, createdAt] of [
    ["A", "member", "institution", 1], ["B", "member", "institution", 2], ["C", "member", "private", 3],
    ["D", "mentor", "institution", 4], ["E", "member2", "institution", 5], ["F", demoMember, "institution", 6],
  ] as const) journey.run(id, userId, `Work ${id}`, `Fictional work ${id}`, "2026-10-01", visibility, createdAt);
  const confirm = database.prepare(`INSERT INTO communityConfirmation (id,journeyId,mentorId,statement,method,journeyVersion,mentorRole) VALUES (?,?,?,?,?,1,'MENTOR')`);
  confirm.run("mine", "B", "mentor", "I checked the code", "Review");
  confirm.run("theirs", "A", "mentor2", "I checked the code", "Review");
  return { database, db };
}

function locals(userId: string | null, extra: Partial<Locals> = {}): Locals {
  return {
    user: userId ? { id: userId, name: userId, email: `${userId}@example.test`, emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) } : null,
    session: null,
    personalAccessToken: null,
    ...extra,
  };
}
const agentSession = { userAgent: "ttv-agent:fixture" } as unknown as Locals["session"];
const token = { scopes: ["community:read"] } as unknown as Locals["personalAccessToken"];

/** What the Confirm page's own API says this caller has waiting, or null when it refuses them. */
async function confirmPageWaiting(db: D1Database, env: AwaitingConfirmationContext["env"], caller: Locals): Promise<number | null> {
  const response = await handleCommunityRequest(new Request("https://example.test/api/community/mentorship"), "mentorship", communityActor(caller), db, env as Env);
  if (response.status !== 200) return null;
  const { entries } = await response.json() as { entries: { reviewedByCurrentMentor: boolean }[] };
  return entries.filter((entry) => !entry.reviewedByCurrentMentor).length;
}

describe("awaitingConfirmation", () => {
  const cases: [string, Locals, AwaitingConfirmationContext["env"], number | null][] = [
    ["a mentor: shared work by others they have not confirmed (A, E, F), never their own or private work", locals("mentor"), {}, 3],
    ["another mentor: their own confirmations only, so A no longer waits for them but B and D do", locals("mentor2"), {}, 4],
    ["an admin, whom the Confirm page also serves (A, B, D, E, F)", locals("admin"), {}, 5],
    ["a member without mentor access", locals("member"), {}, null],
    ["a personal access token, which the Confirm page refuses", locals("mentor", { personalAccessToken: token }), {}, null],
    ["a delegated agent session for a real mentor", locals("mentor", { session: agentSession }), {}, null],
    ["the synthetic demo mentor, scoped to demo members", locals(demoMentor, { session: agentSession, stagingDemo: { persona: "mentor", expiresAt: 0 } }), { DEPLOYMENT_ENVIRONMENT: "staging" }, 1],
    ["the demo mentor outside staging", locals(demoMentor, { session: agentSession, stagingDemo: { persona: "mentor", expiresAt: 0 } }), { DEPLOYMENT_ENVIRONMENT: "production" }, null],
    ["nobody signed in", locals(null), {}, null],
  ];

  it.each(cases)("matches the Confirm page for %s", async (_name, caller, env, expected) => {
    const { db } = setup();
    expect(await awaitingConfirmation({ db, env, locals: caller })).toBe(expected);
    expect(await confirmPageWaiting(db, env, caller)).toBe(expected);
  });

  it("gives retained QA personas no number, since their Confirm page is a separate filtered handler", async () => {
    const { db } = setup();
    const qa = { userId: "mentor", persona: "mentor" } as unknown as NonNullable<Locals["stagingQa"]>;
    expect(await awaitingConfirmation({ db, env: {}, locals: locals("mentor", { stagingQa: qa }) })).toBeNull();
  });

  it("follows confirmations and revisions as they happen", async () => {
    const { database, db } = setup();
    const count = () => awaitingConfirmation({ db, env: {}, locals: locals("mentor") });
    expect(await count()).toBe(3);
    database.exec(`UPDATE communityJourney SET version=2 WHERE id='B'`);
    expect(await count()).toBe(4);
    database.exec(`INSERT INTO communityConfirmation (id,journeyId,mentorId,statement,method,journeyVersion,mentorRole) VALUES ('again','B','mentor','I checked it again','Review',2,'MENTOR')`);
    database.exec(`UPDATE communityJourney SET visibility='private' WHERE id='E'`);
    expect(await count()).toBe(2);
  });

  it("lets database failures through rather than reporting nothing waiting", async () => {
    const { database, db } = setup();
    database.exec(`DROP TABLE communityConfirmation`);
    await expect(awaitingConfirmation({ db, env: {}, locals: locals("mentor") })).rejects.toThrow(/no such table/);
  });
});
