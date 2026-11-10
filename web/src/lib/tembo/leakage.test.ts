import { afterEach, describe, expect, it } from "vitest";
import { VIEWER } from "@/lib/channels/test-support";
import { FINDING_REASONS } from "@/lib/channels/moderation/detectors";
import type { CapabilityCase } from "@/lib/platform/server/capabilities.fixtures";
import type { TemboScope } from "@/lib/platform/contracts";
import { TOOLS_FOR } from "./sources";
import { scriptedModel, temboDatabase, type TemboFixture } from "./test-support";

/**
 * THE LEAKAGE MATRIX (plan §3, "Tembo in channels"). Every place a canary could hide is seeded with a
 * labelled text that matches the same search. For each kind of channel and each role that may ask
 * there, a model that calls every tool there is, with every query that could find a canary, must be
 * shown only what that channel allows, and the same whoever asks: the channel decides, never the
 * asker's role. Positive controls in each row prove the searches really ran.
 */

const QUERY = "budgeting canary 0712 345 678";
const fixtures: TemboFixture[] = [];
afterEach(() => { for (const fixture of fixtures.splice(0)) fixture.database.close(); });

const ASKING = { COHORT: "cohort-04", COMMUNITY: "help", DIRECT: "direct-mine" } as const satisfies Record<TemboScope, string>;
/** Channels whose messages are never this asking channel's: every other channel the caller can or cannot read. */
const CHANNELS = ["cohort-04", "help", "direct-mine", "c04-help", "introductions", "cohort-05", "direct-other"] as const;

function seed(s: TemboFixture) {
  s.database.exec(`INSERT INTO channel (id, kind, slug, name) VALUES ('direct-mine', 'DIRECT', 'review', 'Review'), ('direct-other', 'DIRECT', 'review', 'Review');
    INSERT INTO channel_member (channelId, userId) VALUES ('direct-mine', '${VIEWER}'), ('direct-mine', 'synthetic-otieno'),
      ('direct-other', 'synthetic-otieno'), ('direct-other', 'synthetic-achieng');`);
  const insert = (slug: string, body: string, extra: { state?: "HIDDEN"; parentId?: string; tembo?: boolean } = {}) =>
    s.message(slug.startsWith("direct-") ? `id:${slug}` : slug, { body, ...extra });
  for (const slug of CHANNELS) {
    const label = slug.toUpperCase();
    const root = insert(slug, `HERE-${label} budgeting canary from the channel`);
    insert(slug, `HIDDEN-${label} budgeting canary`, { state: "HIDDEN" });
    const hiddenRoot = insert(slug, `HIDDENROOT-${label} budgeting canary`, { state: "HIDDEN" });
    insert(slug, `UNDERHIDDEN-${label} budgeting canary`, { parentId: hiddenRoot });
    insert(slug, `TEMBOOLD-${label} budgeting canary`, { tembo: true, parentId: root });
    const flagged = insert(slug, `MASKED-${label} budgeting canary, call 0712 345 678`);
    s.database.prepare("UPDATE channel_message SET moderationState = 'FLAGGED', moderationReasons = ? WHERE id = ?")
      .run(JSON.stringify([FINDING_REASONS.phone]), flagged);
    s.database.prepare(`INSERT INTO moderation_event (id, messageId, action, source, actorId, fromState, toState, reasons, createdAt)
      VALUES (?, ?, 'FLAG', 'REPORT', 'synthetic-otieno', 'VISIBLE', 'FLAGGED', ?, 1)`).run(`event-${slug}`, root, JSON.stringify([`MODNOTE-${label} budgeting canary`]));
  }
  s.database.exec(`
    INSERT INTO recording (id, programId, title, processingStatus) VALUES ('rec-a', 'cohort-a', 'Budget session', 'complete'),
      ('rec-b', 'cohort-b', 'Other cohort session', 'complete'), ('rec-a-draft', 'cohort-a', 'Unfinished', 'processing');
    INSERT INTO transcript_segment (id, recordingId, startTime, endTime, text) VALUES
      ('seg-a', 'rec-a', 61, 70, 'OWNSESSION budgeting canary explained'),
      ('seg-b', 'rec-b', 5, 9, 'OTHERCOHORTSESSION budgeting canary'),
      ('seg-draft', 'rec-a-draft', 5, 9, 'DRAFTSESSION budgeting canary');
    INSERT INTO studentProfile (id, userId, handle, status, headline) VALUES
      ('profile-achieng', 'synthetic-achieng', 'achieng', 'PUBLISHED', 'PUBLICPROFILE budgeting canary'),
      ('profile-otieno', 'synthetic-otieno', 'otieno', 'DRAFT', 'UNPUBLISHEDPROFILE budgeting canary'),
      ('profile-faith', 'synthetic-faith', 'faith', 'PUBLISHED', 'NOTCOMPLETEDPROFILE budgeting canary');
    INSERT INTO communityJourney (id, userId, title, description, occurredAt, visibility) VALUES
      ('journey-shared', 'synthetic-otieno', 'SHAREDNOW budgeting canary', 'Current text', '2026-10-01', 'institution'),
      ('journey-unshared', 'synthetic-achieng', 'UNSHAREDJOURNEY budgeting canary', 'x', '2026-10-01', 'institution'),
      ('journey-private', '${VIEWER}', 'PRIVATEJOURNEY budgeting canary', 'x', '2026-10-01', 'private');
    INSERT INTO feedback (id, userId, kind, message, pageUrl, adminNote, response) VALUES
      ('feedback-1', '${VIEWER}', 'BUG', 'FEEDBACK budgeting canary', '/dashboard', 'STAFFNOTE budgeting canary', 'REPLY budgeting canary');
    INSERT INTO chat_message (id, userId, role, content) VALUES ('chat-1', '${VIEWER}', 'user', 'PRIVATECHAT budgeting canary');
    UPDATE programApplication SET application = '{"why":"APPLICATION budgeting canary"}';
    UPDATE programApplication SET completedAt = 1 WHERE userId = 'synthetic-achieng' AND status = 'COMPLETED';`);
  // Otieno shares his project in #help as it was then; its current text was never shared there.
  const sharedIn = s.message("help", { body: "My project" });
  s.database.prepare("UPDATE channel_message SET embeds = ? WHERE id = ?").run(JSON.stringify([{
    type: "project", journeyId: "journey-shared", version: 1, title: "SHAREDPROJECT budgeting canary", summary: "As shared", confirmations: [],
  }]), sharedIn);
  // Shared here once, then made private by its owner: the channel no longer shows it, and nor does Tembo.
  s.database.exec(`INSERT INTO communityJourney (id, userId, title, description, occurredAt, visibility) VALUES
    ('journey-withdrawn', 'synthetic-otieno', 'Withdrawn', 'x', '2026-10-01', 'private')`);
  s.database.exec("UPDATE communityJourney SET state='DRAFT',visibility='institution' WHERE visibility='private'");
  const withdrawn = s.message("help", { body: "Another project" });
  s.database.prepare("UPDATE channel_message SET embeds = ? WHERE id = ?").run(JSON.stringify([{
    type: "project", journeyId: "journey-withdrawn", version: 1, title: "MADEPRIVATE budgeting canary", summary: "x", confirmations: [],
  }]), withdrawn);
  // The same, from someone who does not own the project, never counts as sharing it.
  const notOwner = s.message("help", { body: "Their project", author: "synthetic-achieng" });
  s.database.prepare("UPDATE channel_message SET embeds = ? WHERE id = ?").run(JSON.stringify([{
    type: "project", journeyId: "journey-shared", version: 1, title: "NOTOWNERSHARE budgeting canary", summary: "x", confirmations: [],
  }]), notOwner);
}

/** Labels each kind of channel must show (positive controls) and must never show. */
const ALLOWED: Record<TemboScope, string[]> = {
  COHORT: ["HERE-COHORT-04", "MASKED-COHORT-04", "OWNSESSION"],
  COMMUNITY: ["HERE-HELP", "MASKED-HELP", "PUBLICPROFILE", "UNPUBLISHEDPROFILE", "NOTCOMPLETEDPROFILE", "SHAREDPROJECT"],
  DIRECT: ["HERE-DIRECT-MINE", "MASKED-DIRECT-MINE"],
};
const EVERY_LABEL = [
  ...CHANNELS.flatMap((slug) => ["HERE", "HIDDEN", "HIDDENROOT", "UNDERHIDDEN", "TEMBOOLD", "MASKED", "MODNOTE"].map((kind) => `${kind}-${slug.toUpperCase()}`)),
  "OWNSESSION", "OTHERCOHORTSESSION", "DRAFTSESSION", "PUBLICPROFILE", "UNPUBLISHEDPROFILE", "NOTCOMPLETEDPROFILE", "SHAREDPROJECT",
  "SHAREDNOW", "NOTOWNERSHARE", "MADEPRIVATE", "UNSHAREDJOURNEY", "PRIVATEJOURNEY", "FEEDBACK", "STAFFNOTE", "REPLY", "PRIVATECHAT", "APPLICATION",
];
/** Masked contact details, whoever asks: Tembo is never privileged. */
const NEVER = ["0712", "345 678", "345678"];

const ROLES: Record<string, Partial<CapabilityCase>> = {
  "approved member": { applications: [{ programId: "cohort-a", status: "APPROVED" }] },
  "audit member": { applications: [{ programId: "cohort-a", status: "AUDIT" }] },
  "alumna (completed)": { applications: [{ programId: "cohort-a", status: "COMPLETED" }] },
  "cohort TA": { assignments: [{ programId: "cohort-a", name: "TA" }] },
  "cohort mentor": { assignments: [{ programId: "cohort-a", name: "MENTOR" }] },
  "admin": { globalRoles: ["ADMIN"] },
  "admin and cohort B member": { globalRoles: ["ADMIN"], applications: [{ programId: "cohort-b", status: "APPROVED" }] },
  "institution": { globalRoles: ["INSTITUTION"] },
  "global mentor": { globalRoles: ["MENTOR"] },
};
const COHORT_A = new Set(["approved member", "audit member", "alumna (completed)", "cohort TA", "cohort mentor", "admin", "admin and cohort B member"]);

/** What a model calling every tool (offered or not) with every query is shown, asking in `kind` as `role`. */
async function shown(kind: TemboScope, role: string) {
  const s = temboDatabase(ROLES[role]);
  fixtures.push(s);
  seed(s);
  const slug = ASKING[kind];
  // The searches look for the number; the question itself does not carry it.
  const question = s.question(slug.startsWith("direct-") ? `id:${slug}` : slug, "@tembo what do people say about budgeting canary?");
  const every = ["search_channel", "search_sessions", "search_projects", "get_user_context", "search_transcripts"] as const;
  const { model, calls, seen } = scriptedModel([
    { search: every.map((tool) => [tool, QUERY] as const) },
    { search: [["search_channel", "budgeting"], ["search_sessions", "canary"], ["search_projects", "0712"], ["search_channel", "345 678"]] },
    { answer: "Done [S1]." },
  ]);
  const response = await s.ask(slug.startsWith("direct-") ? `channel:${slug}` : slug, question, { temboModel: model });
  expect(response.status, `${kind} as ${role}`).toBe(202);
  await s.afterResponse();
  expect(calls.map((call) => call.tools).slice(0, 2)).toEqual([[...TOOLS_FOR[kind]], [...TOOLS_FOR[kind]]]);
  const answer = s.rows<{ citations: string }>("SELECT citations FROM channel_message WHERE authorKind = 'TEMBO' AND parentId = ?", question);
  expect(answer).toHaveLength(1);
  return { text: seen(), citations: answer[0]!.citations };
}

describe("Tembo leakage matrix: the channel decides what Tembo reads, never the asker", () => {
  const rows = (Object.keys(ASKING) as TemboScope[]).flatMap((kind) => Object.keys(ROLES)
    .filter((role) => kind !== "COHORT" || COHORT_A.has(role)).map((role) => [kind, role] as const));

  it.each(rows)("%s channel, asked by %s", async (kind, role) => {
    const { text, citations } = await shown(kind, role);
    for (const label of ALLOWED[kind]) expect(text, `${label} is a positive control`).toContain(label);
    for (const label of EVERY_LABEL.filter((other) => !ALLOWED[kind].includes(other))) {
      expect(text, `${kind} as ${role} must not see ${label}`).not.toMatch(new RegExp(`\\b${label}\\b`));
    }
    for (const fragment of NEVER) {
      expect(text).not.toContain(fragment);
      expect(citations).not.toContain(fragment);
    }
  });

  it.each(Object.keys(ASKING) as TemboScope[])("%s: every role that may ask there is shown exactly the same", async (kind) => {
    const roles = Object.keys(ROLES).filter((role) => kind !== "COHORT" || COHORT_A.has(role));
    const texts = new Set<string>();
    for (const role of roles) texts.add((await shown(kind, role)).text);
    expect(texts.size).toBe(1);
  });

  it("another cohort's channel is not even reachable to ask in", async () => {
    const s = temboDatabase(ROLES["approved member"]);
    fixtures.push(s);
    const question = s.question("cohort-05");
    expect((await s.ask("cohort-05", question)).status).toBe(404);
  });

  it("a direct conversation the caller is not in is not reachable, and a message there can't be asked about from elsewhere", async () => {
    const s = temboDatabase(ROLES["admin"]);
    fixtures.push(s);
    seed(s);
    const theirs = s.rows<{ id: string }>("SELECT id FROM channel_message WHERE channelId = 'direct-other' LIMIT 1")[0]!.id;
    expect((await s.ask("channel:direct-other", theirs)).status).toBe(404);
    expect((await s.ask("help", theirs)).status).toBe(404);
  });
});
