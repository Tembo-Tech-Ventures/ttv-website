import { readdirSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/d1";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import * as assessmentProvider from "@/lib/community/assessment-provider";
import type { CommunityActor } from "@/lib/community/actor";
import { handleCommunityRequest } from "@/lib/community/http";
import { createCommunityService } from "@/lib/community/service";
import * as schema from "@/lib/db/schema";
import { capabilitiesFor } from "@/lib/platform/server/capabilities";
import { callProposedAttention } from "@/lib/attention/call-producers";
import { moderationMcpTools } from "@/lib/channels/moderation/mcp";
import { listModerationQueue } from "@/lib/channels/moderation/queue";
import { answerProposal, listCalls, suggestCall } from "./proposals";

/**
 * Owner decision (in-app calls P10): saying "Not now" to a suggested call never reaches the member's
 * profile, assessments or anything outside the conversation; it is treated like a mentor's set-aside
 * (set-aside.test.ts). A mentor suggests a check-in on the member's posted work, the member says "Not
 * now", and everything the member, institutions, admins, search, Discover and the assessment read is
 * exactly as it was, down to the evidence the model is given. The card message is in the moderation
 * queue too (flagged), and an admin reading it there, through the API or MCP, never sees the card.
 */

const databases: { close(): void }[] = [];
afterEach(() => {
  databases.splice(0).forEach((database) => database.close());
  vi.restoreAllMocks();
});

const MIGRATIONS = readdirSync(new URL("../db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted();
const ON = { DEPLOYMENT_ENVIRONMENT: "agent-pr-1", PLATFORM_FLAGS_OVERRIDE: "all" } as Env;
const contribution = {
  title: "Chama savings ledger", description: "Built and tested a fictional ledger for a savings group.",
  evidenceUrl: "https://github.com/example/chama-ledger", occurredAt: "2026-10-20", status: "posted",
} as const;
const profile = { headline: "Builder", bio: "Builds tools for savings groups", skills: ["TypeScript"], opportunityGoals: "First developer role" };
const NOW = Date.parse("2026-11-24T08:00:00Z");

function setup() {
  const { database, db } = createSqliteD1();
  databases.push(database);
  for (const name of MIGRATIONS) database.exec(readMigration(name));
  for (const [id, name] of [["member", "Achieng Otieno"], ["mentor", "Kamau Njoroge"], ["institution", "Savanna Labs"], ["admin", "Amina Hassan"]]) {
    database.prepare(`INSERT INTO "user"(id,name,email) VALUES (?,?,?)`).run(id, name, `${id}@example.test`);
    database.prepare("INSERT INTO channel_conduct(userId,version,acknowledgedAt) VALUES (?,1,1)").run(id);
  }
  for (const [userId, role] of [["mentor", "MENTOR"], ["institution", "INSTITUTION"], ["admin", "ADMIN"]]) {
    database.prepare(`INSERT INTO "UserRoles"(id,userId,roleId) VALUES (?,?,(SELECT id FROM "Roles" WHERE name=?))`).run(`${userId}-${role}`, userId, role);
  }
  // The conversation an accepted mentor request opened.
  database.exec(`INSERT INTO channel(id, kind, slug, name) VALUES ('conversation', 'DIRECT', 'conversation', 'Conversation');
    INSERT INTO channel_member(channelId, userId) VALUES ('conversation', 'member'), ('conversation', 'mentor');`);
  const as = (id: string) => createCommunityService(db, id, undefined, undefined, undefined, {} as Env);
  return { database, db, member: as("member"), institution: as("institution"), admin: as("admin"), mentor: as("mentor") };
}

const browser = (id: string): CommunityActor => ({ id, scopes: null });
async function call(db: D1Database, actor: CommunityActor, method: string, path: string, body?: unknown) {
  const request = new Request(`https://ttv.example/api/community/${path}`, {
    method, headers: { Origin: "https://ttv.example", "Content-Type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const response = await handleCommunityRequest(request, path.split("?")[0]!, actor, db, ON);
  return { status: response.status, json: await response.json() as Record<string, unknown> };
}

describe("saying Not now to a suggested call", () => {
  it("changes nothing the member, institutions, admins, search, Discover or the assessment can see", async () => {
    const f = setup();
    await f.member.updateOwnProfile(profile);
    const work = await f.member.createJourney(contribution);
    const complete = vi.fn().mockResolvedValue(JSON.stringify({ criteria: [{ criterionId: "tool", status: "insufficient", rating: null, explanation: "Not enough documented evidence.", citations: [] }] }));
    vi.spyOn(assessmentProvider, "createAssessmentProvider").mockReturnValue({ model: "test-model", complete });
    const assessment = { id: "hiring", version: 1, criteria: [{ id: "tool", label: "Tool evidence", terms: ["ledger"] }] };

    async function everyoneElse() {
      const institution = browser("institution");
      return {
        memberJourney: await f.member.listJourney(),
        memberProfile: await f.member.getOwnProfile(),
        memberApi: (await call(f.db, browser("member"), "GET", "journey")).json,
        institutionProfile: await f.institution.getProfile("member"),
        institutionJourney: await f.institution.listJourney("member"),
        institutionApi: (await call(f.db, institution, "GET", "profiles/member")).json,
        search: await f.institution.searchProfiles({ query: "savings" }),
        discovery: await f.institution.discoveryEvidence(),
        adminJourney: await f.admin.listJourney("member"),
        mentorWaiting: await f.mentor.countAwaitingConfirmation(),
        moderationQueue: await listModerationQueue(d1, { user: { id: "admin" }, capabilities: await capabilitiesFor(drizzled, { id: "admin" }) }, {}),
        mcpQueue: await moderationMcpTools({ db: d1, env: ON, locals: { user: { id: "admin" } } as App.Locals, scopes: null })
          .call("list_moderation_queue", {}),
        assessment: (await call(f.db, institution, "POST", "profiles/member/assessment", assessment)).json,
        journeys: f.database.prepare("SELECT * FROM communityJourney ORDER BY id").all(),
        confirmations: f.database.prepare("SELECT * FROM communityConfirmation ORDER BY id").all(),
        setAsides: f.database.prepare("SELECT * FROM communitySetAside ORDER BY rowid").all(),
        profiles: f.database.prepare("SELECT * FROM studentProfile ORDER BY id").all(),
      };
    }

    const d1 = f.db;
    const drizzled = drizzle(d1, { schema });
    const caller = async (userId: string) => ({ userId, capabilities: await capabilitiesFor(drizzled, { id: userId }), checkins: true });
    const ctx = { db: d1, now: NOW };
    const { proposalId } = await suggestCall(ctx, await caller("mentor"), {
      conversationId: "conversation", token: "notnowtokennotnowtoken0", purpose: "CHECKIN", journeyId: work.id, bookedMinutes: 30,
      times: [NOW + 24 * 60 * 60_000], askToRecord: true,
    });
    await callProposedAttention({ db: d1, env: { PLATFORM_FLAGS_OVERRIDE: "all" } }, proposalId, false, NOW);
    // Its card message is flagged, so it waits in the admins' moderation queue.
    const card = (f.database.prepare("SELECT messageId FROM call_proposal WHERE id = ?").get(proposalId) as { messageId: string }).messageId;
    f.database.prepare(`INSERT INTO moderation_event (id, messageId, action, source, actorId, fromState, toState, reasons, createdAt)
      VALUES ('flag', ?, 'FLAG', 'DETECTOR', NULL, 'VISIBLE', 'FLAGGED', '["Contact details"]', ?)`).run(card, NOW);
    const attention = () => f.database.prepare("SELECT userId, kind FROM attention_item ORDER BY rowid").all();
    expect(attention()).toEqual([{ userId: "member", kind: "call_proposed" }]);

    const before = await everyoneElse();
    expect(complete.mock.calls).toHaveLength(1);
    // The admin sees the message's case (its words, which are what a report is about), and nothing of
    // the card: not its state, its work's revision or whether recording was asked.
    expect(before.moderationQueue.items.map((item) => [item.message.id, item.message.embeds])).toEqual([[card, []]]);
    expect(JSON.stringify(before.mcpQueue)).toContain(card);
    expect(JSON.stringify([before.moderationQueue, before.mcpQueue])).not.toMatch(/callProposal|askToRecord|proposedBy/);
    await answerProposal(ctx, await caller("member"), proposalId, { kind: "notNow" });
    const after = await everyoneElse();

    expect(after).toEqual(before);
    // The model saw exactly the same evidence, and nothing anyone else reads says how it was answered.
    expect(complete.mock.calls[1]).toEqual(complete.mock.calls[0]);
    expect(JSON.stringify(after)).not.toMatch(/not now|declined|call_proposal|callProposal/i);
    // No notice is written for it: the mentor's bell gets nothing, and the member's suggestion notice is all there is.
    expect(attention()).toEqual([{ userId: "member", kind: "call_proposed" }]);
    // Outside the conversation, the mentor's own Calls page simply no longer lists it as waiting.
    expect((await listCalls(d1, await caller("mentor"), NOW)).waiting).toEqual([]);
  });
});
