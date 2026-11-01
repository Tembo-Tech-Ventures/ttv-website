import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ChannelShareables, ErrorEnvelope, Message, MessageList, type EmbedRef, type MessageEmbedView, type SessionClipEmbed,
} from "@/lib/platform/contracts";
import { CLIP_SECONDS, SHAREABLE_LIMITS } from "./embeds";
import { channelDatabase, post, VIEWER, type ChannelFixture } from "./test-support";

vi.mock("@/lib/observability/errors", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/observability/errors")>(),
  recordErrorInBackground: vi.fn(),
}));

/**
 * Embeds (B-2.4). Wanjiku (the caller) is an APPROVED member of cohort A ("Cohort 04": cohort-04,
 * c04-help, c04-announcements); cohort B is "Cohort 05". Otieno (member) and Achieng (alumna) are in
 * cohort A, Faith is its TA. Projects are communityJourney rows; clips come from cohort recordings.
 */
const fixtures: ChannelFixture[] = [];
afterEach(() => { fixtures.splice(0).forEach(({ database }) => database.close()); vi.restoreAllMocks(); });
const cohortMember = { applications: [{ programId: "cohort-a", status: "APPROVED" as const }] };

function setup(fixture: Parameters<typeof channelDatabase>[0] = cohortMember) {
  const s = channelDatabase(fixture);
  fixtures.push(s);
  s.agree();
  const { database } = s;
  /** A project, published unless told otherwise. */
  function journey(id: string, options: { owner?: string; visibility?: "institution" | "private"; version?: number; title?: string;
    description?: string; evidenceUrl?: string | null; updatedAt?: number } = {}) {
    database.prepare(`INSERT INTO communityJourney (id, userId, title, description, evidenceUrl, occurredAt, visibility, version, updatedAt)
      VALUES (?, ?, ?, ?, ?, '2026-10-01', ?, ?, ?)`).run(id, options.owner ?? VIEWER, options.title ?? `Project ${id}`,
      options.description ?? "Turns M-Pesa receipts into one shared ledger.", options.evidenceUrl === undefined ? `https://example.com/${id}` : options.evidenceUrl,
      options.visibility ?? "institution", options.version ?? 1, options.updatedAt ?? 1);
  }
  const confirm = (journeyId: string, mentorId: string, version: number) => database.prepare(`INSERT INTO communityConfirmation
      (id, journeyId, mentorId, statement, method, journeyVersion) VALUES (?, ?, ?, 'Reviewed the code with them.', 'Code review', ?)`)
    .run(`confirm-${journeyId}-${mentorId}-${version}`, journeyId, mentorId, version);
  /** A recording with a transcript: one segment per `[start, end, text]`. */
  function recording(id: string, options: { program?: string | null; status?: string; duration?: number | null; recordedAt?: number;
    segments?: [number, number, string][] } = {}) {
    database.prepare(`INSERT INTO recording (id, programId, title, processingStatus, durationSeconds, recordedAt) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, options.program === undefined ? "cohort-a" : options.program, `Session ${id} · Webhooks and retries`, options.status ?? "complete",
        options.duration === undefined ? 3600 : options.duration, options.recordedAt ?? 1);
    for (const [i, [start, end, text]] of (options.segments ?? [[0, 30, "Welcome back."], [30, 70, "Today: retries."]]).entries()) {
      database.prepare("INSERT INTO transcript_segment (id, recordingId, startTime, endTime, text) VALUES (?, ?, ?, ?, ?)")
        .run(`${id}-segment-${i}`, id, start, end, text);
    }
  }
  const project = (journeyId: string, version = 1): EmbedRef => ({ type: "project", journeyId, version });
  const clip = (recordingId: string, startSeconds = 0, durationSeconds = 60): EmbedRef => ({ type: "sessionClip", recordingId, startSeconds, durationSeconds });
  /** Posts `embeds` as the caller (or `user`) into the channel with this slug. */
  const share = (slug: string, embeds: EmbedRef[], options: { user?: string; nonce?: string; body?: string } = {}) =>
    s.call("postMessage", { id: s.channel(slug), user: options.user, body: { ...post(options.body ?? "Have a look", null, options.nonce), embeds } });
  /** The embeds of one message, as `user` reads the channel's latest page. */
  async function seen(slug: string, messageId: string, user?: string): Promise<MessageEmbedView[]> {
    const response = await s.call("listMessages", { id: s.channel(slug), user });
    expect(response.status).toBe(200);
    const item = MessageList.parse(response.body).items.find((message) => message.id === messageId);
    if (!item) throw new Error(`${messageId} is not on the page`);
    return item.embeds;
  }
  const stored = () => s.database.prepare("SELECT COUNT(*) AS n FROM channel_message").get() as { n: number };
  return { ...s, journey, confirm, recording, project, clip, share, seen, stored };
}
type Setup = ReturnType<typeof setup>;
const errorOf = (body: unknown) => ErrorEnvelope.parse(body).error;
const sent = (response: { status: number; body: unknown }) => {
  expect(response.status, `${JSON.stringify(response.body)}`).toBe(201);
  return Message.parse(response.body);
};
/** A refusal that wrote nothing. */
async function refused(s: Setup, response: Promise<{ status: number; body: unknown }>) {
  const before = s.stored();
  const { status, body } = await response;
  expect(s.stored()).toEqual(before);
  return { status, ...errorOf(body) };
}
const PROJECT_REFUSED = { status: 400, code: "validation", message: "This project can't be shared here." };
const CLIP_REFUSED = { status: 400, code: "validation", message: "Session clips can only be shared in that cohort's own channels." };

describe("sharing a project", () => {
  it("resolves the caller's own published project at its revision, with the mentors' confirmations", async () => {
    const s = setup();
    s.journey("ledger", { version: 2, title: "Chama ledger", description: "A  ledger\nfor a savings group." });
    s.confirm("ledger", "synthetic-faith", 1);
    s.confirm("ledger", "synthetic-faith", 2);
    s.confirm("ledger", "synthetic-achieng", 1);
    const message = sent(await s.share("show-your-work", [s.project("ledger", 2)]));
    const expected = {
      type: "project", journeyId: "ledger", version: 2, title: "Chama ledger", summary: "A ledger for a savings group.", skills: [],
      link: "https://example.com/ledger",
      confirmations: [
        { mentorId: "synthetic-faith", mentorName: "Faith Njeri", version: 2 },
        { mentorId: "synthetic-achieng", mentorName: "Achieng Atieno", version: 1 },
      ],
    };
    expect(message.embeds).toEqual([expected]);
    expect(await s.seen("show-your-work", message.id, "synthetic-otieno")).toEqual([expected]);
  });

  it("has no link when the project has no evidence page, or one a reader shouldn't open", async () => {
    const s = setup();
    s.journey("none", { evidenceUrl: null });
    s.journey("plain-http", { evidenceUrl: "http://example.com/insecure" });
    // oxlint-disable-next-line no-script-url -- Adversarial stored data must never become a link.
    s.journey("script", { evidenceUrl: "javascript:alert(1)" });
    const message = sent(await s.share("help", [s.project("none"), s.project("plain-http"), s.project("script")]));
    expect(message.embeds.map((embed) => embed.type === "project" && embed.link)).toEqual([null, null, null]);
  });

  it("refuses a private draft, telling its owner how to share it", async () => {
    const s = setup();
    s.journey("draft", { visibility: "private" });
    expect(await refused(s, s.share("help", [s.project("draft")]))).toEqual({
      status: 400, code: "validation", message: "This project is a private draft. Publish it before you share it.",
    });
  });

  it("refuses someone else's project exactly as it refuses one that does not exist", async () => {
    const s = setup();
    s.journey("otieno-work", { owner: "synthetic-otieno" });
    s.journey("otieno-draft", { owner: "synthetic-otieno", visibility: "private" });
    for (const id of ["otieno-work", "otieno-draft", "no-such-project"]) {
      expect(await refused(s, s.share("help", [s.project(id)])), `${id}`).toEqual(PROJECT_REFUSED);
    }
  });

  it("refuses a stale revision with a conflict, so the composer offers the current one", async () => {
    const s = setup();
    s.journey("ledger", { version: 3 });
    expect(await refused(s, s.share("help", [s.project("ledger", 2)]))).toEqual({
      status: 409, code: "conflict", message: "This project has changed since you picked it. Pick it again to share the latest revision.",
    });
    expect(await refused(s, s.share("help", [s.project("ledger", 4)]))).toMatchObject({ status: 409 });
  });

  it("can be shared in DIRECT conversations and thread replies too", async () => {
    const s = setup();
    s.journey("ledger");
    s.database.exec(`INSERT INTO channel(id, kind, slug, name) VALUES ('direct', 'DIRECT', 'review', 'Review');
      INSERT INTO channel_member(channelId, userId) VALUES ('direct', '${VIEWER}');`);
    const direct = await s.call("postMessage", { id: "direct", body: { ...post(), embeds: [s.project("ledger")] } });
    expect(sent(direct).embeds).toHaveLength(1);
    const root = s.message("help");
    expect(sent(await s.call("postMessage", { id: s.channel("help"), body: { ...post("Mine", root), embeds: [s.project("ledger")] } })).embeds)
      .toHaveLength(1);
  });
});

describe("a shared project later", () => {
  const unavailable = [{ type: "unavailable", was: "project" }];

  it("becomes a neutral unavailable card for every reader, author included, once made private, and comes back when published", async () => {
    const s = setup();
    s.journey("ledger", { title: "Chama ledger", description: "Secret sauce" });
    s.confirm("ledger", "synthetic-faith", 1);
    const message = sent(await s.share("show-your-work", [s.project("ledger")]));
    // Making a project private is an edit: its revision moves on.
    s.database.exec("UPDATE communityJourney SET visibility = 'private', version = version + 1 WHERE id = 'ledger'");
    for (const user of [VIEWER, "synthetic-otieno", "synthetic-faith"]) {
      const response = await s.call("listMessages", { id: s.channel("show-your-work"), user });
      expect(MessageList.parse(response.body).items.find((item) => item.id === message.id)?.embeds, `${user}`).toEqual(unavailable);
      expect(JSON.stringify(response.body), `${user}`).not.toMatch(/Chama ledger|Secret sauce|ledger|Faith Njeri/);
    }
    s.database.exec("UPDATE communityJourney SET visibility = 'institution', version = version + 1 WHERE id = 'ledger'");
    expect(await s.seen("show-your-work", message.id, "synthetic-otieno")).toMatchObject([{ type: "project", version: 1, title: "Chama ledger" }]);
  });

  it("is unavailable once deleted, or once its owner's account is", async () => {
    const s = setup();
    s.journey("ledger");
    s.journey("other");
    const message = sent(await s.share("help", [s.project("ledger"), s.project("other")]));
    s.database.exec("DELETE FROM communityJourney WHERE id = 'ledger'");
    expect(await s.seen("help", message.id, "synthetic-otieno")).toEqual([unavailable[0], expect.objectContaining({ journeyId: "other" })]);
    s.database.exec(`DELETE FROM "user" WHERE id = '${VIEWER}'`);
    expect(await s.seen("help", message.id, "synthetic-otieno")).toEqual([unavailable[0], unavailable[0]]);
  });

  it("keeps showing the revision that was shared after an edit, with only the confirmations that apply up to it", async () => {
    const s = setup();
    s.journey("ledger", { title: "First take" });
    const message = sent(await s.share("help", [s.project("ledger")]));
    s.database.exec("UPDATE communityJourney SET title = 'Second take', version = 2 WHERE id = 'ledger'");
    s.confirm("ledger", "synthetic-faith", 2);
    s.confirm("ledger", "synthetic-achieng", 1);
    expect(await s.seen("help", message.id, "synthetic-otieno")).toEqual([expect.objectContaining({
      version: 1, title: "First take", confirmations: [{ mentorId: "synthetic-achieng", mentorName: "Achieng Atieno", version: 1 }],
    })]);
  });
});

describe("sharing a session clip", () => {
  it("resolves a clip of the cohort's own recording in its channels, quoting what was said in the window", async () => {
    const s = setup();
    s.recording("s9", { segments: [[70, 80, "  outside  "], [25, 35, "Then retries."], [0, 30, "If the provider sends it twice,"]] });
    const expected: SessionClipEmbed = {
      type: "sessionClip", recordingId: "s9", title: "Session s9 · Webhooks and retries", startSeconds: 10, durationSeconds: 30,
      quote: "If the provider sends it twice, Then retries.",
    };
    for (const slug of ["cohort-04", "c04-help"]) {
      const message = sent(await s.share(slug, [s.clip("s9", 10, 30)]));
      expect(message.embeds).toEqual([expected]);
      for (const reader of ["synthetic-otieno", "synthetic-achieng", "synthetic-faith"]) {
        expect(await s.seen(slug, message.id, reader), `${slug} ${reader}`).toEqual([expected]);
      }
    }
  });

  it("shortens a long quotation at a word", async () => {
    const s = setup();
    s.recording("long", { segments: [[0, 60, "retry ".repeat(100)]] });
    const [embed] = sent(await s.share("cohort-04", [s.clip("long")])).embeds;
    const quote = embed?.type === "sessionClip" ? embed.quote : "";
    expect(quote.length).toBeLessThanOrEqual(280);
    expect(quote).toMatch(/retry…$/);
  });

  it("is refused in community channels and DIRECT conversations, before anything is read", async () => {
    const s = setup();
    s.recording("s9");
    s.database.exec(`INSERT INTO channel(id, kind, slug, name) VALUES ('direct', 'DIRECT', 'review', 'Review');
      INSERT INTO channel_member(channelId, userId) VALUES ('direct', '${VIEWER}');`);
    for (const slug of ["help", "introductions"]) expect(await refused(s, s.share(slug, [s.clip("s9")])), `${slug}`).toEqual(CLIP_REFUSED);
    const prepare = vi.spyOn(s.d1, "prepare");
    expect(await refused(s, s.call("postMessage", { id: "direct", body: { ...post(), embeds: [s.clip("s9")] } }))).toEqual(CLIP_REFUSED);
    expect(prepare.mock.calls.some(([query]) => /recording|transcript_segment/.test(query))).toBe(false);
  });

  it("refuses another cohort's recording exactly as a missing one, even for someone in both cohorts", async () => {
    const s = setup({ applications: [{ programId: "cohort-a", status: "APPROVED" }, { programId: "cohort-b", status: "COMPLETED" }] });
    s.recording("b-session", { program: "cohort-b" });
    s.recording("no-program", { program: null });
    for (const id of ["b-session", "no-program", "no-such-recording"]) {
      expect(await refused(s, s.share("cohort-04", [s.clip(id)])), `${id}`).toEqual(CLIP_REFUSED);
    }
    // In its own cohort's channel, the same person may share it.
    expect(sent(await s.share("cohort-05", [s.clip("b-session")])).embeds).toHaveLength(1);
  });

  it("refuses an unfinished recording, a clip past the end and a moment with nothing to quote", async () => {
    const s = setup();
    s.recording("processing", { status: "transcribing" });
    s.recording("short", { duration: 100 });
    s.recording("quiet", { segments: [[0, 30, "Hello."]] });
    expect(await refused(s, s.share("cohort-04", [s.clip("processing")]))).toEqual({
      status: 400, code: "validation", message: "This session isn't ready to share yet." });
    expect(await refused(s, s.share("cohort-04", [s.clip("short", 50, 52)]))).toEqual({
      status: 400, code: "validation", message: "That clip runs past the end of the session." });
    expect(await refused(s, s.share("cohort-04", [s.clip("quiet", 300, 60)]))).toEqual({
      status: 400, code: "validation", message: "There's no transcript at that moment of the session to quote." });
    // Up to the end (within a second of rounding) is fine.
    expect(sent(await s.share("cohort-04", [s.clip("short", 41, 60)])).embeds).toHaveLength(1);
  });

  it("is refused where the caller cannot post, such as an announcements channel", async () => {
    const s = setup();
    s.recording("s9");
    expect(await refused(s, s.share("c04-announcements", [s.clip("s9")]))).toMatchObject({ status: 403, code: "forbidden" });
  });
});

describe("a shared clip later", () => {
  it("is unavailable once the recording moves to another cohort, is removed or stops being complete", async () => {
    const s = setup();
    for (const id of ["moved", "removed", "reprocessing", "kept"]) s.recording(id);
    const message = sent(await s.share("cohort-04", ["moved", "removed", "reprocessing", "kept"].map((id) => s.clip(id))));
    s.database.exec(`UPDATE recording SET programId = 'cohort-b' WHERE id = 'moved';
      DELETE FROM recording WHERE id = 'removed'; UPDATE recording SET processingStatus = 'failed' WHERE id = 'reprocessing';`);
    const gone = { type: "unavailable", was: "sessionClip" };
    for (const reader of [VIEWER, "synthetic-otieno", "synthetic-faith"]) {
      const response = await s.call("listMessages", { id: s.channel("cohort-04"), user: reader });
      const embeds = MessageList.parse(response.body).items.find((item) => item.id === message.id)?.embeds;
      expect(embeds, `${reader}`).toEqual([gone, gone, gone, expect.objectContaining({ recordingId: "kept" })]);
      expect(JSON.stringify(response.body)).not.toMatch(/Session (moved|removed|reprocessing)|"moved"|"removed"/);
    }
  });

  it("shows nothing at all once the message is deleted", async () => {
    const s = setup();
    s.recording("s9");
    const message = sent(await s.share("cohort-04", [s.clip("s9")]));
    expect((await s.call("deleteMessage", { id: message.id })).status).toBe(200);
    expect(await s.seen("cohort-04", message.id, "synthetic-otieno")).toEqual([]);
  });
});

describe("attaching: limits and retries", () => {
  it("refuses more than five embeds, and the same work twice", async () => {
    const s = setup();
    for (let i = 1; i <= 6; i++) s.journey(`p${i}`);
    const six = [1, 2, 3, 4, 5, 6].map((i) => s.project(`p${i}`));
    expect(await refused(s, s.share("help", six))).toMatchObject({ status: 400, code: "validation" });
    expect(sent(await s.share("help", six.slice(0, 5))).embeds).toHaveLength(5);
    expect(await refused(s, s.share("help", [s.project("p1"), s.project("p2"), s.project("p1")]))).toEqual({
      status: 400, code: "validation", message: "Each item can be attached once." });
  });

  it("refuses work that cannot be read back as a reference, such as a clip longer than ten minutes", async () => {
    const s = setup();
    s.recording("s9");
    expect(await refused(s, s.share("cohort-04", [s.clip("s9", 0, 601)]))).toMatchObject({ status: 400, code: "validation" });
    const forged = await refused(s, s.call("postMessage", { id: s.channel("help"),
      body: { ...post(), embeds: [{ ...s.project("x"), title: "I am confirmed" }] } }));
    expect(forged).toMatchObject({ status: 400, code: "validation" });
  });

  it("returns the original to a retry with the same work, even after the project went private, and 409 for different work", async () => {
    const s = setup();
    s.journey("ledger");
    s.journey("other");
    const first = sent(await s.share("help", [s.project("ledger")], { nonce: "retry-1" }));
    const again = await s.share("help", [s.project("ledger")], { nonce: "retry-1" });
    expect([again.status, Message.parse(again.body).id]).toEqual([200, first.id]);
    expect(await refused(s, s.share("help", [s.project("other")], { nonce: "retry-1" }))).toMatchObject({ status: 409, code: "conflict" });
    expect(await refused(s, s.share("help", [], { nonce: "retry-1" }))).toMatchObject({ status: 409, code: "conflict" });
    s.database.exec("UPDATE communityJourney SET visibility = 'private', version = 2 WHERE id = 'ledger'");
    const late = await s.share("help", [s.project("ledger")], { nonce: "retry-1" });
    expect([late.status, Message.parse(late.body).embeds]).toEqual([200, [{ type: "unavailable", was: "project" }]]);
  });
});

describe("shareables", () => {
  const list = async (s: Setup, slug: string, query = "", user?: string) => {
    const response = await s.call("listShareables", { id: s.channel(slug), query, user });
    expect(response.status, `${JSON.stringify(response.body)}`).toBe(200);
    return ChannelShareables.parse(response.body);
  };

  it("offers the caller's own published projects, most recently changed first, and no clips outside cohort channels", async () => {
    const s = setup();
    s.journey("older", { updatedAt: 10 });
    s.journey("newer", { updatedAt: 20, version: 3 });
    s.journey("draft", { visibility: "private", updatedAt: 30 });
    s.journey("otieno-work", { owner: "synthetic-otieno", updatedAt: 40 });
    s.confirm("newer", "synthetic-faith", 3);
    s.confirm("newer", "synthetic-achieng", 4);
    s.recording("s9");
    const shareables = await list(s, "help");
    expect(shareables.clips).toEqual([]);
    expect(shareables.projects.map(({ journeyId, version }) => [journeyId, version])).toEqual([["newer", 3], ["older", 1]]);
    expect(shareables.projects[0]?.confirmations).toEqual([{ mentorId: "synthetic-faith", mentorName: "Faith Njeri", version: 3 }]);
  });

  it("offers a clip from the start of each of the cohort's newest complete recordings with a transcript there", async () => {
    const s = setup();
    for (let i = 1; i <= SHAREABLE_LIMITS.recentSessions + 1; i++) s.recording(`r${i}`, { recordedAt: i });
    s.recording("failed", { status: "failed", recordedAt: 100 });
    s.recording("other-cohort", { program: "cohort-b", recordedAt: 100 });
    s.recording("late-start", { recordedAt: 100, segments: [[90, 100, "Late"]] });
    s.recording("short", { recordedAt: 50, duration: 20 });
    const { clips } = await list(s, "cohort-04");
    expect(clips.map((clip) => [clip.recordingId, clip.startSeconds, clip.durationSeconds])).toEqual([
      ["short", 0, 20], ...[11, 10, 9, 8, 7, 6, 5, 4, 3].map((i) => [`r${i}`, 0, CLIP_SECONDS]),
    ]);
    expect(clips[1]?.quote).toBe("Welcome back. Today: retries.");
  });

  it("finds moments by what was said, case-insensitively and literally, offering each window once", async () => {
    const s = setup();
    s.recording("s9", { segments: [[0, 20, "Hello"], [125.6, 130, "Idempotency KEYS matter"], [125.9, 128, "keys again"], [400, 410, "100% keys"]] });
    s.recording("other-cohort", { program: "cohort-b", segments: [[0, 10, "keys"]] });
    const { clips } = await list(s, "cohort-04", "?q=keys");
    expect(clips.map((clip) => [clip.recordingId, clip.startSeconds])).toEqual([["s9", 125], ["s9", 400]]);
    expect(clips[0]?.quote).toBe("Idempotency KEYS matter keys again");
    expect((await list(s, "cohort-04", "?q=%25")).clips.map((clip) => clip.startSeconds)).toEqual([400]);
    expect((await list(s, "cohort-04", "?q=nothing")).clips).toEqual([]);
  });

  it("offers only what posts as offered", async () => {
    const s = setup();
    s.journey("ledger", { version: 2 });
    s.recording("s9", { duration: 130, segments: [[0, 30, "Start"], [100, 130, "Retry storms"]] });
    const { projects, clips } = await list(s, "cohort-04", "?q=retry");
    const refs: EmbedRef[] = [
      ...projects.map(({ journeyId, version }) => ({ type: "project" as const, journeyId, version })),
      ...clips.map(({ recordingId, startSeconds, durationSeconds }) => ({ type: "sessionClip" as const, recordingId, startSeconds, durationSeconds })),
    ];
    expect(refs).toHaveLength(2);
    expect(sent(await s.share("cohort-04", refs)).embeds).toEqual([...projects, ...clips]);
  });

  it("offers nothing where the caller cannot post", async () => {
    const s = setup();
    s.journey("ledger");
    s.recording("s9");
    expect(await list(s, "c04-announcements")).toEqual({ projects: [], clips: [] });
  });

  it("is 404 for a channel the caller cannot read, and refuses a malformed query", async () => {
    const s = setup();
    expect((await s.call("listShareables", { id: s.channel("cohort-05") })).status).toBe(404);
    for (const query of ["?q=", "?q=%20", `?q=${"x".repeat(201)}`, "?q=a&q=b", "?programId=cohort-b"]) {
      const response = await s.call("listShareables", { id: s.channel("cohort-04"), query });
      expect([response.status, errorOf(response.body).code], `${query}`).toEqual([400, "validation"]);
    }
  });
});

describe("embeds: query plans", () => {
  /** EXPLAIN QUERY PLAN for every statement a call prepares. */
  async function plans(s: Setup, run: () => Promise<unknown>) {
    const found: string[] = [];
    const prepare = s.d1.prepare.bind(s.d1);
    vi.spyOn(s.d1, "prepare").mockImplementation(((query: string) => {
      const statement = prepare(query);
      const bind = statement.bind.bind(statement);
      statement.bind = (...values: unknown[]) => {
        if (/embedAccess|json_each\(\?1\)|communityJourney j WHERE|WITH m AS/.test(query)) {
          found.push((s.database.prepare(`EXPLAIN QUERY PLAN ${query}`).all(...values as never[]) as { detail: string }[])
            .map((row) => row.detail).join("\n"));
        }
        return bind(...values);
      };
      return statement;
    }) as typeof s.d1.prepare);
    await run();
    vi.restoreAllMocks();
    return found.join("\n---\n");
  }

  it("resolves, re-checks and lists through primary keys and indexes, never scanning projects, recordings or transcripts", async () => {
    const s = setup();
    s.journey("ledger");
    s.recording("s9");
    const plan = await plans(s, async () => {
      sent(await s.share("cohort-04", [s.project("ledger"), s.clip("s9")]));
      await s.call("listMessages", { id: s.channel("cohort-04") });
      await s.call("listShareables", { id: s.channel("cohort-04"), query: "?q=retries" });
      await s.call("listShareables", { id: s.channel("cohort-04") });
    });
    expect(plan).toContain("transcript_segment_recording_time_idx");
    expect(plan).toContain("communityJourney_userId_visibility_idx");
    expect(plan).toContain("communityConfirmation_journeyId_idx");
    expect(plan).toContain("recording_program_idx");
    expect(plan).not.toMatch(/SCAN (j|r|s|c|cu|recording|transcript_segment|communityJourney|communityConfirmation)\b/);
  });
});
