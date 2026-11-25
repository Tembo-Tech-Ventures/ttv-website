import { readdirSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { drizzle } from "drizzle-orm/d1";
import { Window } from "happy-dom";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import * as schema from "@/lib/db/schema";
import { createSqliteD1, readMigration } from "@/test/sqlite-d1";
import { withRaw } from "@/lib/attention/test-support";
import type { EmbedRef } from "@/lib/platform/contracts";

/*
 * P1's acceptance matrix: every path that reads a recording, for every kind of person, on SQLite with
 * every migration. The expectations are written out by hand from the scope table (lib/recordings/
 * access.ts), not computed by the policy, so the test checks the policy as well as each path's use of it.
 *
 * Recordings: cohort A's, complete and still transcribing; cohort B's; one with no cohort; cohort
 * A's hidden and deleted ones; and a direct conversation's (Wanjiku's and Juma's) and a community
 * channel's, which every path here refuses to everyone, their own members and admins included: these
 * are session paths, and only a path that asks for everything (none yet) reads a channel's recording.
 * Every one has a stored video and a transcript line matching "Webhook".
 */
const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown>, getSession: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("@/lib/auth", async () => {
  const { sessionApi } = await import("@/test/auth-mock");
  return { createAuth: () => ({ api: sessionApi(mocks.getSession) }) };
});

const { onRequest } = await import("@/middleware");
const { default: SessionsPage } = await import("@/pages/dashboard/sessions/index.astro");
const { default: ViewerPage } = await import("@/pages/dashboard/sessions/[id].astro");
const { GET: video } = await import("@/pages/api/recordings/[id]/video");
const { GET: suggestions } = await import("@/pages/api/chat/suggestions");
const { searchPlatform } = await import("@/lib/search/service");
const { executeTool } = await import("@/lib/chat/tools");
const { privateAskScope } = await import("@/lib/tembo/private-ask");
const { SourceBook, toolsFor } = await import("@/lib/tembo/sources");
const { embedAccessColumn, listShareables, resolveEmbeds } = await import("@/lib/channels/embeds");
const { recordingReadyAttention } = await import("@/lib/attention/producers");
const { listAttention } = await import("@/lib/attention/service");
const { capabilitiesFor, channelAccessFor } = await import("@/lib/platform/server/capabilities");
const { GET: chatHistory } = await import("@/pages/api/chat/sessions/[id]");
const { GET: chatSessions } = await import("@/pages/api/chat/sessions/index");
const { WITHHELD_ANSWER } = await import("@/lib/chat/stored-sources");
const { readMessage, TEMBO_SESSION_GONE } = await import("@/lib/channels/messages");

const RECORDINGS = ["a-ready", "a-working", "b-ready", "loose", "a-hidden", "a-deleted", "direct", "community"] as const;
type RecordingId = (typeof RECORDINGS)[number];
const COMPLETE: ReadonlySet<RecordingId> = new Set(["a-ready", "b-ready", "loose", "a-hidden", "a-deleted", "direct", "community"]);

const A_MEMBER: RecordingId[] = ["a-ready", "a-working"];
const A_HOST: RecordingId[] = ["a-ready", "a-working", "a-hidden"];
interface Person {
  id: string; name: string; setup: string;
  /** What they may watch: the Sessions list, the viewer, the video and attention reads. */
  watches: RecordingId[];
  /** What Ask Tembo tells them it reads. */
  ask: "COHORTS" | "ALL_COHORTS" | "NONE";
  /** The "ready to watch" notices they are sent. */
  notified: RecordingId[];
  /** Whether they have the Cohort space at all (capabilitiesFor): an applicant has it, a community member doesn't. */
  cohortSpace?: false;
}
const application = (id: string, programId: string, status: string) =>
  `INSERT INTO programApplication(id,userId,programId,status,application) VALUES ('application-${id}','${id}','${programId}','${status}','{}');`;
const assignment = (id: string, programId: string, role: string) =>
  `INSERT INTO programRole(id,userId,programId,name) VALUES ('role-${id}','${id}','${programId}','${role}');`;
const PEOPLE: Person[] = [
  { id: "synthetic-approved", name: "Wanjiku Njeri", setup: application("synthetic-approved", "cohort-a", "APPROVED"), watches: A_MEMBER, ask: "COHORTS", notified: ["a-ready"] },
  { id: "synthetic-audit", name: "Achieng Otieno", setup: application("synthetic-audit", "cohort-a", "AUDIT"), watches: A_MEMBER, ask: "COHORTS", notified: ["a-ready"] },
  { id: "synthetic-completed", name: "Kamau Mwangi", setup: application("synthetic-completed", "cohort-a", "COMPLETED"), watches: A_MEMBER, ask: "COHORTS", notified: ["a-ready"] },
  { id: "synthetic-instructor", name: "Otieno Ouma", setup: assignment("synthetic-instructor", "cohort-a", "INSTRUCTOR"), watches: A_HOST, ask: "COHORTS", notified: ["a-ready"] },
  { id: "synthetic-ta", name: "Faith Njeri", setup: assignment("synthetic-ta", "cohort-a", "TA"), watches: A_HOST, ask: "COHORTS", notified: ["a-ready"] },
  { id: "synthetic-other-cohort", name: "Mwende Kilonzo", setup: application("synthetic-other-cohort", "cohort-b", "APPROVED"), watches: ["b-ready"], ask: "COHORTS", notified: ["b-ready"] },
  { id: "synthetic-no-cohort", name: "Juma Hassan", setup: "", watches: [], ask: "NONE", notified: [], cohortSpace: false },
  // Their place in cohort A was taken away after they were sent its notice, which no longer shows.
  { id: "synthetic-revoked", name: "Njoki Wambui", setup: application("synthetic-revoked", "cohort-a", "APPROVED"), watches: [], ask: "NONE", notified: ["a-ready"] },
  { id: "synthetic-admin", name: "Amina Hassan", watches: ["a-ready", "a-working", "b-ready", "loose", "a-hidden"], ask: "ALL_COHORTS", notified: [],
    setup: `INSERT INTO UserRoles(id,userId,roleId) SELECT 'admin-role','synthetic-admin',id FROM Roles WHERE name='ADMIN';` },
];
/** Transcript paths read only what they may watch whose processing is complete. */
const readsTranscripts = (person: Person) => person.watches.filter((id) => COMPLETE.has(id));
const TITLES: Record<RecordingId, string> = {
  "a-ready": "Cohort A week 3", "a-working": "Cohort A week 4", "b-ready": "Cohort B week 3",
  loose: "Unsorted upload", "a-hidden": "Cohort A hidden", "a-deleted": "Cohort A deleted",
  direct: "Wanjiku and Juma's check-in", community: "Open hours",
};
const idOfTitle = (title: string) => RECORDINGS.find((id) => TITLES[id] === title);
/** Transcript words an answer stored when Tembo read them. */
const STORED_WORDS = "Webhook retries need idempotency keys";
/** An Ask Tembo citation as pages/api/chat.ts stores it. */
const citationOf = (id: RecordingId) => ({
  sourceNumber: 1, recordingId: id, title: TITLES[id], startTime: 0, endTime: 30, url: `/dashboard/sessions/${id}?t=0`, text: STORED_WORDS,
});
const sorted = (ids: readonly (string | undefined)[]) => [...ids].toSorted();

let sqlite: DatabaseSync;
let d1: D1Database;
let db: schema.Database;
let channels: Record<"cohort-a" | "cohort-b", string>;
let container: AstroContainer;

beforeAll(async () => {
  const created = createSqliteD1();
  sqlite = created.database;
  for (const file of readdirSync(new URL("../db/migrations/", import.meta.url)).filter((name) => name.endsWith(".sql")).toSorted()) {
    sqlite.exec(readMigration(file));
  }
  sqlite.exec(`INSERT INTO curriculum(id,title,description) VALUES ('curriculum','Synthetic curriculum','Test');
    INSERT INTO program(id,name,description,curriculumId,startDate,endDate) VALUES ('cohort-a','Cohort A','Test','curriculum',0,4102444800),
      ('cohort-b','Cohort B','Test','curriculum',0,4102444800);
    INSERT OR IGNORE INTO Roles(id,name) VALUES ('ADMIN','ADMIN');
    UPDATE feature_flag SET audience='ALL';`);
  for (const person of PEOPLE) {
    sqlite.prepare("INSERT INTO user(id,name,email) VALUES (?,?,?)").run(person.id, person.name, `${person.id}@example.test`);
    sqlite.exec(person.setup);
  }
  sqlite.exec(`INSERT INTO channel(id,kind,slug,name) VALUES ('conversation','DIRECT','dm','Wanjiku and Juma');
    INSERT INTO channel_member(channelId,userId) VALUES ('conversation','synthetic-approved'),('conversation','synthetic-no-cohort');`);
  const recordings: [RecordingId, string | null, string, string][] = [
    ["a-ready", "cohort-a", "complete", ""], ["a-working", "cohort-a", "transcribing", ""], ["b-ready", "cohort-b", "complete", ""],
    ["loose", null, "complete", ""], ["a-hidden", "cohort-a", "complete", "hiddenAt=1"], ["a-deleted", "cohort-a", "complete", "deletedAt=1"],
    ["direct", null, "complete", "accessScope='DIRECT', channelId='conversation'"],
    ["community", null, "complete", "accessScope='COMMUNITY', channelId=(SELECT id FROM channel WHERE seedKey='community:help')"],
  ];
  for (const [i, [id, programId, status, change]] of recordings.entries()) {
    sqlite.prepare(`INSERT INTO recording(id,programId,title,processingStatus,r2VideoKey,durationSeconds,recordedAt,transcriptText)
      VALUES (?,?,?,?,?,3600,?,'Webhook retries, the whole session')`).run(id, programId, TITLES[id], status, `recordings/${id}.mp4`, 1_790_000_000 + i * 86_400);
    if (change) sqlite.exec(`UPDATE recording SET ${change} WHERE id='${id}'`);
    sqlite.prepare("INSERT INTO transcript_segment(id,recordingId,startTime,endTime,speaker,text) VALUES (?,?,0,30,'Mentor','Webhook retries need idempotency keys')")
      .run(`segment-${id}`, id);
  }
  d1 = withRaw(sqlite, created.db);
  db = drizzle(d1, { schema });
  const bucket = { head: vi.fn(async () => ({ size: 5 })), get: vi.fn(async () => ({ body: "video", httpMetadata: { contentType: "video/mp4" } })) };
  Object.assign(mocks.env, { DB: d1, BUCKET: bucket, DEPLOYMENT_ENVIRONMENT: "production" });
  channels = Object.fromEntries(["cohort-a", "cohort-b"].map((programId) => [programId,
    (sqlite.prepare("SELECT id FROM channel WHERE seedKey = ?").get(`cohort:${programId}:main`) as { id: string }).id])) as typeof channels;

  // Stored copies of transcript words: each person's Ask Tembo history holds one answer per recording,
  // citing it as Tembo read it, one that read cohort A's hidden session without citing it, and a
  // conversation whose latest answer cites that hidden session. Cohort A's channel holds one Tembo
  // answer per recording, quoting it, in the thread of a question.
  const saveMessage = sqlite.prepare(`INSERT INTO chat_message(id,sessionId,userId,role,content,citations,createdAt) VALUES (?,?,?,'assistant',?,?,?)`);
  for (const person of PEOPLE) {
    sqlite.prepare("INSERT INTO chat_session(id,userId,title) VALUES (?,?,'Webhooks'), (?,?,'Hidden')")
      .run(`history-${person.id}`, person.id, `preview-${person.id}`, person.id);
    for (const [i, id] of RECORDINGS.entries()) {
      saveMessage.run(`history-${person.id}-${id}`, `history-${person.id}`, person.id, `${STORED_WORDS} (${id})`,
        JSON.stringify([citationOf(id), { type: "read", recordingId: id }]), 1_000 + i);
    }
    saveMessage.run(`history-${person.id}-traced`, `history-${person.id}`, person.id, `${STORED_WORDS} (traced)`,
      JSON.stringify([{ type: "read", recordingId: "a-hidden" }]), 2_000);
    saveMessage.run(`preview-${person.id}-latest`, `preview-${person.id}`, person.id, `${STORED_WORDS} (preview)`,
      JSON.stringify([citationOf("a-hidden"), { type: "read", recordingId: "a-hidden" }]), 3_000);
  }
  const post = sqlite.prepare(`INSERT INTO channel_message(id,channelId,parentId,seq,changeSeq,authorKind,authorId,body,citations,createdAt)
    SELECT ?1, ?2, ?3, n.next, n.next, ?4, ?5, ?6, ?7, 1 FROM (SELECT coalesce(MAX(changeSeq), 0) + 1 AS next FROM channel_message WHERE channelId = ?2) n`);
  post.run("tembo-question", channels["cohort-a"], null, "USER", "synthetic-approved", "@tembo what about webhooks?", "[]");
  for (const id of RECORDINGS) {
    post.run(`tembo-${id}`, channels["cohort-a"], "tembo-question", "TEMBO", null, `${STORED_WORDS} [1]`, JSON.stringify([{
      type: "sessionClip", recordingId: id, startSeconds: 0, title: `${TITLES[id]} at 0:00`, href: `/dashboard/sessions/${id}?t=0`,
    }]));
  }

  // Every notice goes out once, while the revoked person still held their place.
  for (const id of RECORDINGS) await recordingReadyAttention({ db: d1, env: mocks.env as never }, id);
  sqlite.exec("UPDATE programApplication SET status='REJECTED' WHERE userId='synthetic-revoked'");
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});
afterAll(() => sqlite.close());

const userOf = (person: Person) => ({ id: person.id, name: person.name, email: `${person.id}@example.test`, image: null, emailVerified: true, createdAt: new Date(0), updatedAt: new Date(0) });

/** A signed-in GET of a dashboard page through the real middleware. */
async function visit(person: Person, page: typeof SessionsPage, path: string, params: Record<string, string> = {}) {
  const url = new URL(path, "https://ttv.invalid");
  mocks.getSession.mockResolvedValue({ user: userOf(person), session: { id: `${person.id}-session`, userId: person.id, userAgent: "Mozilla/5.0" } });
  const locals = {} as App.Locals;
  const context = {
    url, request: new Request(url), locals, params,
    cookies: { get: () => undefined, set: () => {} },
    redirect: (location: string, status = 302) => new Response(null, { status, headers: { location } }),
  };
  const response = await onRequest(context as never, async () =>
    container.renderToResponse(page, { request: new Request(url), locals, params })) as Response;
  return { status: response.status, body: await response.text() };
}

const apiContext = (person: Person, params: Record<string, string> = {}) =>
  ({ params, request: new Request("https://ttv.invalid/api"), locals: { user: userOf(person) } }) as never;

async function toolContext(person: Person) {
  const vectors = RECORDINGS.map((id) => ({ metadata: { segment_id: `segment-${id}`, recording_id: id, start_time: 0, end_time: 30 } }));
  const env = { AI: { run: vi.fn(async () => ({ data: [[0.1, 0.2]] })) }, VECTORIZE: { query: vi.fn(async () => ({ matches: vectors })) } } as unknown as Env;
  return { env, db, userId: person.id, userName: person.name, capabilities: await capabilitiesFor(db, { id: person.id }), sources: [] };
}

/** A cohort channel as this person reads it, for the clip paths. */
async function channelFor(person: Person, programId: "cohort-a" | "cohort-b") {
  const capabilities = channelAccessFor(await capabilitiesFor(db, { id: person.id }), { kind: "COHORT", programId, postingPolicy: "ALL", archivedAt: null });
  return { db: d1, viewerId: person.id, channel: { id: channels[programId], kind: "COHORT" as const, programId, capabilities } };
}
const clip = (recordingId: string): EmbedRef => ({ type: "sessionClip", recordingId, startSeconds: 0, durationSeconds: 30 });

describe.each(PEOPLE)("recording access for $id", (person) => {
  it("the Sessions list shows what they may watch, at any processing status", async () => {
    const { status, body } = await visit(person, SessionsPage, "/dashboard/cohort/sessions");
    if (person.cohortSpace === false) return expect(status).toBe(403);
    expect(status).toBe(200);
    const { document } = new Window();
    document.body.innerHTML = body;
    const listed = [...document.querySelectorAll("[data-session-card]")].map((card) => card.getAttribute("href")!.split("/").at(-1));
    expect(sorted(listed)).toEqual(sorted(person.watches));
  });

  it.each([...RECORDINGS, "missing"])("the viewer opens %s only if they may watch it, else the same 404", async (id) => {
    const { status, body } = await visit(person, ViewerPage, `/dashboard/cohort/sessions/${id}`, { id });
    // Without the Cohort space the space guard refuses first, alike for every id.
    if (person.cohortSpace === false) return expect(status).toBe(403);
    const may = (person.watches as string[]).includes(id);
    expect(status).toBe(may ? 200 : 404);
    // The player shows whenever the video exists, whether or not the transcript is ready.
    if (may) expect(body).toContain(`/api/recordings/${id}/video`);
    else expect(body).toBe("Not found.");
  });

  it.each([...RECORDINGS, "missing"])("the video of %s plays only if they may watch it, else the same 404", async (id) => {
    const response = await video(apiContext(person, { id }));
    expect(response.status).toBe((person.watches as string[]).includes(id) ? 200 : 404);
  });

  it("platform search finds moments only in transcripts they may read", async () => {
    const result = await searchPlatform(d1, person.id, { q: "Webhook", scope: "sessionMoments" });
    expect(sorted(result.sessionMoments.map((moment) => moment.recordingId))).toEqual(sorted(readsTranscripts(person)));
  });

  it("Ask Tembo's scope says what it reads", async () => {
    expect(privateAskScope(await capabilitiesFor(db, { id: person.id }))).toBe(person.ask);
  });

  it("Ask Tembo's list_recordings lists only transcripts they may read", async () => {
    const { recordings } = JSON.parse(await executeTool("list_recordings", { limit: 25 }, await toolContext(person))) as { recordings: { id: string }[] };
    expect(sorted(recordings.map(({ id }) => id))).toEqual(sorted(readsTranscripts(person)));
  });

  it.each([...RECORDINGS, "missing"])("Ask Tembo's get_recording_details reads %s only if they may watch it", async (id) => {
    const result = JSON.parse(await executeTool("get_recording_details", { recording_id: id }, await toolContext(person))) as Record<string, unknown>;
    if (!(person.watches as string[]).includes(id)) return expect(result).toEqual({ error: "Recording not found" });
    expect(result.id).toBe(id);
    expect(result.transcript).toBe(COMPLETE.has(id as RecordingId) ? "Webhook retries, the whole session" : null);
  });

  it("Ask Tembo's search_transcripts re-checks every Vectorize match through the policy", async () => {
    const { results } = JSON.parse(await executeTool("search_transcripts", { query: "webhook retries" }, await toolContext(person))) as { results?: { videoLink: string }[] };
    const found = (results ?? []).map(({ videoLink }) => videoLink.split("/").at(-1)!.split("?")[0]);
    expect(sorted(found)).toEqual(sorted(readsTranscripts(person)));
  });

  it("Tembo's suggestions name only sessions they may read, newest first", async () => {
    const { suggestions: offered } = await (await suggestions(apiContext(person))).json() as { suggestions: string[] };
    const newest = readsTranscripts(person).toSorted((a, b) => RECORDINGS.indexOf(b) - RECORDINGS.indexOf(a)).slice(0, 3);
    const named = offered.flatMap((text) => /"(.+)"/.exec(text)?.[1] ?? []).map(idOfTitle);
    expect(named).toEqual(newest);
  });

  it("clips: they can post, list and see only cohort A's own visible session in its channel", async () => {
    const ctx = await channelFor(person, "cohort-a");
    const { clips } = await listShareables(ctx);
    const shares = ctx.channel.capabilities.canShareSessionClip;
    expect(clips.map(({ recordingId }) => recordingId)).toEqual(shares ? ["a-ready"] : []);
    for (const id of RECORDINGS) {
      const posting = resolveEmbeds(ctx, [clip(id)]);
      if (shares && id === "a-ready") await expect(posting).resolves.toHaveLength(1);
      else await expect(posting).rejects.toMatchObject({ status: 400 });
    }
  });

  it("the attention producer sent them only notices for their cohort's visible, complete sessions", () => {
    const sent = sqlite.prepare("SELECT subjectId FROM attention_item WHERE userId = ? AND kind = 'recording_ready'").all(person.id) as { subjectId: string }[];
    expect(sorted(sent.map(({ subjectId }) => subjectId))).toEqual(sorted(person.notified));
  });

  it("attention shows a recording notice only while they may still watch it", async () => {
    // Every person holds a notice for every recording, as if each had once applied.
    for (const id of RECORDINGS) {
      sqlite.prepare(`INSERT OR IGNORE INTO attention_item(id,userId,eventKey,kind,space,category,subjectKind,subjectId,subjectHref,subjectLabel,summary,createdAt)
        VALUES (?,?,?,'recording_ready','cohort','updates','recording',?,?,'Cohort recording','A recording in your cohort is ready to watch.',?)`)
        .run(`notice-${person.id}-${id}`, person.id, JSON.stringify(["recording_ready", id]), id, `/dashboard/sessions/${id}`, Date.now() - 60_000);
    }
    const { items } = await listAttention(db, person.id, {}, await capabilitiesFor(db, { id: person.id }));
    const shown = items.filter((item) => item.subject.kind === "recording").map((item) => item.subject.id);
    expect(sorted(shown)).toEqual(sorted(person.watches));
  });

  it("Ask Tembo's history keeps an answer's words only while they may still read every session it drew on", async () => {
    const response = await chatHistory(apiContext(person, { id: `history-${person.id}` }));
    expect(response.status).toBe(200);
    const { messages } = await response.json() as { messages: { id: string; content: string; citations: { type?: string }[] }[] };
    const readable = readsTranscripts(person);
    const kept = messages.filter(({ content }) => content !== WITHHELD_ANSWER).map(({ id }) => id.replace(`history-${person.id}-`, ""));
    // The traced answer read the hidden session without citing it.
    expect(sorted(kept)).toEqual(sorted([...readable, ...readable.includes("a-hidden") ? ["traced"] : []]));
    for (const message of messages) {
      expect(message.citations.some(({ type }) => type === "read")).toBe(false);
      if (message.content === WITHHELD_ANSWER) expect(message.citations).toEqual([]);
      else expect(message.content).toContain(STORED_WORDS);
    }
  });

  it("Ask Tembo's conversation list never previews an answer from a session they may no longer read", async () => {
    const { sessions } = await (await chatSessions(apiContext(person))).json() as { sessions: { id: string; latestMessage: string | null }[] };
    const preview = sessions.find(({ id }) => id === `preview-${person.id}`)?.latestMessage;
    expect(preview).toBe(readsTranscripts(person).includes("a-hidden") ? `${STORED_WORDS} (preview)` : WITHHELD_ANSWER);
  });

  it("Tembo's answers in cohort A's channel keep a session's words only while the whole cohort may read it, for every reader", async () => {
    const ctx = await channelFor(person, "cohort-a");
    if (!ctx.channel.capabilities.canRead) return;
    for (const id of RECORDINGS) {
      const answer = await readMessage(ctx, `tembo-${id}`);
      // Read as the cohort: its hosts and admins see a hidden session's answer withheld too.
      const shown = id === "a-ready";
      expect(answer?.body).toBe(shown ? `${STORED_WORDS} [1]` : TEMBO_SESSION_GONE);
      expect(answer?.citations.map((citation) => citation.type)).toEqual(shown ? ["sessionClip"] : []);
    }
  });

  it("message search finds a Tembo answer's words only while the whole cohort may read its session", async () => {
    const { messages } = await searchPlatform(d1, person.id, { q: "idempotency", scope: "messages" }, { messages: true });
    const tembo = messages.filter(({ author }) => author.name === "Tembo").map(({ id }) => id);
    const reads = (await channelFor(person, "cohort-a")).channel.capabilities.canRead;
    expect(tembo).toEqual(reads ? ["tembo-a-ready"] : []);
  });
});

describe("a conversation's and the community's recordings", () => {
  it("are ones the policy would let their channel's readers watch, which no path here asks for", async () => {
    const { recordingAccessFor } = await import("./access");
    const row = (id: RecordingId) => sqlite.prepare("SELECT programId, accessScope, channelId, deletedAt, hiddenAt FROM recording WHERE id = ?").get(id) as never;
    const community = (sqlite.prepare("SELECT id FROM channel WHERE seedKey='community:help'").get() as { id: string }).id;
    for (const person of PEOPLE) {
      const capabilities = await capabilitiesFor(db, { id: person.id });
      const member = ["synthetic-approved", "synthetic-no-cohort"].includes(person.id);
      const everything = { userId: person.id, reach: "everything" as const };
      expect(recordingAccessFor(capabilities, row("direct"), { ...everything, channel: { id: "conversation", kind: "DIRECT", isMember: member } })).toBe(member);
      expect(recordingAccessFor(capabilities, row("community"), { ...everything, channel: { id: community, kind: "COMMUNITY", isMember: false } })).toBe(true);
      expect(recordingAccessFor(capabilities, row("direct"), { userId: person.id, channel: { id: "conversation", kind: "DIRECT", isMember: member } })).toBe(false);
    }
  });
});

describe("recordings read for a whole cohort channel, whoever asks", () => {
  it.each(["cohort-a", "cohort-b"] as const)("Tembo in %s's channel reads only that cohort's visible, complete sessions", async (programId) => {
    const book = new SourceBook();
    const tools = toolsFor({ db: d1, book, channel: { id: channels[programId], kind: "COHORT", slug: "main", programId }, questionId: "question" });
    const { results } = JSON.parse(await tools.run("search_sessions", JSON.stringify({ query: "webhook retries idempotency" }))) as { results: { title: string }[] };
    expect(sorted(results.map(({ title }) => idOfTitle(title)))).toEqual([programId === "cohort-a" ? "a-ready" : "b-ready"]);
  });

  it("a stored clip stays visible to a cohort channel's readers only while its recording is the cohort's, visible and complete", async () => {
    const embeds = JSON.stringify(RECORDINGS.map((id) => ({ type: "sessionClip", recordingId: id, title: TITLES[id], startSeconds: 0, durationSeconds: 30, quote: "Webhook" })));
    const access = (programId: string) => {
      const row = sqlite.prepare(`SELECT ${embedAccessColumn("?1")} FROM (SELECT NULL AS deletedAt, ?2 AS embeds, 'synthetic-approved' AS authorId) m`)
        .get(programId, embeds) as { embedAccess: string };
      return (JSON.parse(row.embedAccess) as unknown[]).flatMap((check, i) => check === null ? [] : [RECORDINGS[i]]);
    };
    expect(access("cohort-a")).toEqual(["a-ready"]);
    expect(access("cohort-b")).toEqual(["b-ready"]);
  });

  it("an admin can share another cohort's session in that cohort's channel, and nowhere else", async () => {
    const admin = PEOPLE.find(({ id }) => id === "synthetic-admin")!;
    await expect(resolveEmbeds(await channelFor(admin, "cohort-b"), [clip("b-ready")])).resolves.toHaveLength(1);
    await expect(resolveEmbeds(await channelFor(admin, "cohort-b"), [clip("a-ready")])).rejects.toMatchObject({ status: 400 });
    await expect(resolveEmbeds(await channelFor(admin, "cohort-a"), [clip("loose")])).rejects.toMatchObject({ status: 400 });
  });
});
