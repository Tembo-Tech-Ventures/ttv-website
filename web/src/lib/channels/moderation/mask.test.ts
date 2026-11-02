import { afterEach, describe, expect, it, vi } from "vitest";
import { findReadableChannel } from "@/lib/channels/access";
import { loadChannelPage } from "@/lib/channels/page";
import { MASKED_CONTACT, MAX_CONTACT_MASKS, Message, MessageList, SearchQuery } from "@/lib/platform/contracts";
import { capabilitiesFor } from "@/lib/platform/server/capabilities";
import { searchMessages } from "@/lib/search/messages";
import { channelDatabase, post, type ChannelFixture } from "../test-support";
import { contactSpans, FINDING_REASONS } from "./detectors";
import { bodyForReader, MASK_CACHE_CHARS, maskSpans } from "./mask";

// The real detectors, counted: a read served from the mask cache never computes spans again.
vi.mock("./detectors", async (actual) => {
  const detectors = await actual<typeof import("./detectors")>();
  return { ...detectors, contactSpans: vi.fn(detectors.contactSpans) };
});
const spansComputed = vi.mocked(contactSpans);

const M = MASKED_CONTACT;
const flagged = (body: string, reasons: string[] = [FINDING_REASONS.phone]) => ({ body, moderationState: "FLAGGED" as const, reasons });
const masked = (body: string) => bodyForReader(flagged(body), false);

describe("contactSpans and maskSpans", () => {
  it.each([
    ["Call me on 0712 345 678 after class", `Call me on ${M} after class`],
    ["Text +254 712 345 678 tonight", `Text ${M} tonight`],
    ["oh seven two two , 345 678 is my line", `${M} is my line`],
    ["Write to jane dot doe at gmail dot com please", `Write to ${M} please`],
    ["Join chat.whatsapp.com/AbCdEf123 now", `Join ${M} now`],
    ["Open whatsapp://send?phone=254712345678 now", `Open ${M} now`],
    // Fullwidth digits map back to the characters as typed.
    ["Number: ０７１２３４５６７８!", `Number: ${M}!`],
    // Neighbouring details share one marker; words between them stay.
    ["0712 345 678, 0733 445 566 or me@gmail.com", `${M} or ${M}`],
    // A link to a site with a number in its path is not a phone number, and stays.
    ["See example.com/orders/0712345678 and 0712 345 678", `See example.com/orders/0712345678 and ${M}`],
  ])("masks %j", (body, expected) => {
    expect(masked(body)).toBe(expected);
  });

  it("leaves shortened links, mention floods and ordinary numbers alone", () => {
    for (const body of ["Slides at bit.ly/abc123", "@a @b @c @d @e look", "Cohort 04 starts 2026-11-02 at 10:30, KSh 1,500"]) {
      expect(contactSpans(body)).toEqual([]);
      expect(masked(body)).toBe(body);
    }
  });

  it("covers the rest of a body after MAX_CONTACT_MASKS markers, so the wire limit holds", () => {
    const body = Array.from({ length: 40 }, (_, i) => `person${i}@gmail.com word`).join(" ");
    const result = masked(body);
    expect(result.split(M)).toHaveLength(MAX_CONTACT_MASKS + 1);
    expect(result.endsWith(M)).toBe(true);
    expect(result).not.toContain("@gmail.com");
    expect(maskSpans("abcdef", [[1, 2], [3, 4]])).toBe(`a${M}c${M}ef`);
    expect(Message.shape.body.safeParse(masked("a@gmail.com x ".repeat(700).slice(0, 10_000))).success).toBe(true);
  });

  it("masks a page of the longest bodies full of numbers once, and serves every later read from the cache", () => {
    const bodies = Array.from({ length: 50 }, (_, i) => `${i} call 0712 345 678 or a${i}@gmail.com `.repeat(300).slice(0, 10_000));
    spansComputed.mockClear();
    const first = bodies.map(masked);
    expect(spansComputed).toHaveBeenCalledTimes(50);
    expect(first.every((body) => !body.includes("0712"))).toBe(true);
    spansComputed.mockClear();
    expect(bodies.map(masked)).toEqual(first);
    expect(spansComputed).not.toHaveBeenCalled();
  });

  it("holds at most MASK_CACHE_CHARS characters, keys and values together, dropping the least recently read", () => {
    // Each entry is 20,000 characters or more (a 10,000 character body and its mask), so the bound fits fewer than this many.
    const fits = Math.floor(MASK_CACHE_CHARS / 20_000);
    const bodies = Array.from({ length: fits + 20 }, (_, i) => `bound ${i} 0712 345 678 `.padEnd(10_000, "x"));
    const [oldest = "", kept = ""] = bodies;
    masked(oldest);
    masked(kept);
    for (const body of bodies.slice(2)) {
      masked(body);
      masked(kept); // Read again and again, so it stays.
    }
    spansComputed.mockClear();
    masked(kept);
    masked(bodies.at(-1) ?? "");
    expect(spansComputed).not.toHaveBeenCalled();
    masked(oldest);
    expect(spansComputed).toHaveBeenCalledTimes(1);
  });

  it("masks only FLAGGED messages with a contact reason, for readers without the privilege", () => {
    const body = "Call 0712 345 678";
    expect(bodyForReader(flagged(body), true)).toBe(body);
    expect(bodyForReader({ ...flagged(body), moderationState: "VISIBLE" }, false)).toBe(body);
    expect(bodyForReader({ ...flagged(body), moderationState: "HIDDEN" }, false)).toBe(body);
    expect(bodyForReader(flagged(body, ["Uses a shortened link", "Clef: harassment"]), false)).toBe(body);
    for (const reason of [FINDING_REASONS.phone, FINDING_REASONS.email, FINDING_REASONS.invite]) {
      expect(bodyForReader(flagged(body, ["Clef: spam", reason]), false)).toBe(`Call ${M}`);
    }
  });
});

// ─── Every read path, for every kind of reader ─────────────────────────────

const OTIENO = "synthetic-otieno";
const ACHIENG = "synthetic-achieng";
const MENTOR = "synthetic-mentor";
const ADMIN = "synthetic-admin";
const INSTITUTION = "synthetic-institution";
const TEXT = "Hi @Achieng Atieno, call me on 0712 345 678 or write to otieno.o@gmail.com. See you Friday!";
const MASKED = `Hi @Achieng Atieno, call me on ${M} or write to ${M}. See you Friday!`;
const SECRETS = ["0712", "345 678", "gmail", "otieno.o"];
const leaks = (value: unknown) => SECRETS.filter((secret) => JSON.stringify(value).includes(secret));

/** Who reads, how, and whether they see the whole text. */
const READERS = [
  { name: "the author", user: OTIENO, whole: true },
  { name: "a moderator of the channel", user: MENTOR, whole: true },
  { name: "an admin", user: ADMIN, whole: true },
  { name: "another member", user: ACHIENG, whole: false },
  { name: "an institution user", user: INSTITUTION, whole: false },
  // Only admins hold channels tokens (they die with the role), so a token reads as an admin.
  { name: "an admin's token", user: ADMIN, whole: true, token: true },
] as const;
type Reader = (typeof READERS)[number];

const fixtures: ChannelFixture[] = [];
afterEach(() => { fixtures.splice(0).forEach(({ database }) => database.close()); });
function setup() {
  const s = channelDatabase();
  fixtures.push(s);
  for (const [id, role] of [[MENTOR, "MENTOR"], [ADMIN, "ADMIN"], [INSTITUTION, "INSTITUTION"]] as const) {
    s.database.prepare('INSERT INTO "user"(id,name,email) VALUES (?,?,?)').run(id, id, `${id}@example.test`);
    s.database.prepare("INSERT OR IGNORE INTO Roles(id,name) VALUES (?,?)").run(role, role);
    s.database.prepare("INSERT INTO UserRoles(id,userId,roleId) SELECT ?,?,id FROM Roles WHERE name=?").run(`role-${id}`, id, role);
  }
  s.agree(OTIENO);
  return s;
}
const token = (reader: Reader) => "token" in reader
  ? { locals: { personalAccessToken: { id: "synthetic-pat", scopes: ["channels:read"] } } as never, origin: null } : {};
async function read(s: ChannelFixture, reader: Reader, channelId: string, query = "") {
  const response = await s.call("listMessages", { id: channelId, user: reader.user, query, ...token(reader) });
  expect(response.status).toBe(200);
  return MessageList.parse(response.body);
}
async function send(s: ChannelFixture, channelId: string, body: string, parentId: string | null = null) {
  const response = await s.call("postMessage", { id: channelId, user: OTIENO, body: post(body, parentId) });
  expect(response.status).toBe(201);
  await s.afterResponse();
  return Message.parse(response.body);
}
const bodyOf = (page: MessageList, id: string) => page.items.find((item) => item.id === id)?.body;

describe("masked contact details on every read path", () => {
  it.each(READERS)("$name: page, latest, before, since, thread and search", async (reader) => {
    const s = setup();
    const channelId = s.channel("introductions");
    const checkpoint = (await read(s, reader, channelId)).sinceCursor;
    const sent = await send(s, channelId, TEXT);
    const reply = await send(s, channelId, "Or my other line, 0733 445 566. Thanks", sent.id);
    const expected = reader.whole ? TEXT : MASKED;
    // The author's own copy comes back whole.
    expect(sent.body).toBe(TEXT);

    expect(bodyOf(await read(s, reader, channelId), sent.id)).toBe(expected);
    expect(bodyOf(await read(s, reader, channelId, `?since=${checkpoint}`), sent.id)).toBe(expected);
    expect(bodyOf(await read(s, reader, channelId, `?thread=${sent.id}`), reply.id))
      .toBe(reader.whole ? "Or my other line, 0733 445 566. Thanks" : `Or my other line, ${M}. Thanks`);
    if (!("token" in reader)) {
      const channel = await findReadableChannel(s.db, { id: reader.user }, { space: "community", slug: "introductions" });
      const page = await loadChannelPage(s.db, s.d1, reader.user, channel!, { thread: sent.id });
      expect(bodyOf(page.initial, sent.id)).toBe(expected);
      if (!reader.whole) expect(leaks(page)).toEqual([]);
    }
    for (let i = 0; i < 50; i += 1) s.message("introductions", { author: ACHIENG });
    const latest = await read(s, reader, channelId);
    expect(bodyOf(latest, sent.id)).toBeUndefined();
    expect(bodyOf(await read(s, reader, channelId, `?before=${latest.beforeCursor}`), sent.id)).toBe(expected);


    const search = async (q: string) => searchMessages(s.d1, s.db, {
      userId: reader.user, capabilities: await capabilitiesFor(s.db, { id: reader.user }),
      query: SearchQuery.parse({ q, scope: "messages" }), limit: 10,
    });
    const [hit] = await search("Friday");
    expect(hit?.id).toBe(sent.id);
    // Searching for the details themselves finds the message only for those who may see them.
    for (const q of ["0712", "otieno.o@gmail.com", "Friday gmail", "0733"]) {
      expect({ q, found: (await search(q)).length > 0 }).toEqual({ q, found: reader.whole });
    }
    if (reader.whole) expect(hit?.excerpt).toContain("0712");
    else {
      expect(hit?.excerpt).toContain(M);
      expect(leaks(hit)).toEqual([]);
    }
  });

  it("tells a mentioned member without repeating the details", async () => {
    const s = setup();
    await send(s, s.channel("introductions"), TEXT);
    const rows = s.database.prepare("SELECT * FROM attention_item WHERE userId = ?").all(ACHIENG);
    expect(rows).toHaveLength(1);
    expect(leaks(rows)).toEqual([]);
  });
});

describe("masks until a person decides", () => {
  const member = READERS[3];

  it("an admin's keep shows the whole text to everyone, and polling delivers it", async () => {
    const s = setup();
    const channelId = s.channel("introductions");
    const sent = await send(s, channelId, TEXT);
    const checkpoint = (await read(s, member, channelId)).sinceCursor;
    const kept = await s.call("moderateMessage", { id: sent.id, user: ADMIN, body: { action: "keep", reason: "Shared on purpose" } });
    expect(kept.status).toBe(200);
    expect(bodyOf(await read(s, member, channelId, `?since=${checkpoint}`), sent.id)).toBe(TEXT);
    expect(bodyOf(await read(s, member, channelId), sent.id)).toBe(TEXT);
  });

  it("a hide follows the hidden rules: removed for members, whole for its author", async () => {
    const s = setup();
    const channelId = s.channel("introductions");
    const sent = await send(s, channelId, TEXT);
    const checkpoint = (await read(s, member, channelId)).sinceCursor;
    expect((await s.call("moderateMessage", { id: sent.id, user: MENTOR, body: { action: "hide", reason: "Contact details" } })).status).toBe(200);
    const delta = await read(s, member, channelId, `?since=${checkpoint}`);
    expect(delta.removedIds).toContain(sent.id);
    expect(leaks(delta)).toEqual([]);
    expect(bodyOf(await read(s, READERS[0], channelId), sent.id)).toBe(TEXT);
  });

  it("an edit that removes the number unmasks the rest; one that adds a number never reaches a poll unmasked", async () => {
    const s = setup();
    const channelId = s.channel("introductions");
    const sent = await send(s, channelId, TEXT);
    let checkpoint = (await read(s, member, channelId)).sinceCursor;
    const clean = "Hi @Achieng Atieno, ask me in this channel. See you Friday!";
    expect((await s.call("editMessage", { id: sent.id, user: OTIENO, body: { body: clean } })).status).toBe(200);
    let delta = await read(s, member, channelId, `?since=${checkpoint}`);
    expect(bodyOf(delta, sent.id)).toBe(clean);

    const plain = await send(s, channelId, "Notes from today are in the doc");
    checkpoint = delta.sinceCursor;
    const edited = "Notes from today: ring 0722 000 111 for the doc";
    expect((await s.call("editMessage", { id: plain.id, user: OTIENO, body: { body: edited } })).status).toBe(200);
    delta = await read(s, member, channelId, `?since=${checkpoint}`);
    expect(bodyOf(delta, plain.id)).toBe(`Notes from today: ring ${M} for the doc`);
    expect(JSON.stringify(delta)).not.toContain("0722");
  });
});
