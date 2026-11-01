import { describe, expect, it } from "vitest";
import { detectFindings, FINDING_REASONS, MENTION_FLOOD, textKey, type FindingKind } from "./detectors";

/**
 * The detector fixture table: every common spelling of what the detectors look for, and the
 * phone-shaped and link-shaped things people write every day that must not be flagged. Synthetic
 * people and numbers only (07xx 345 678 style numbers are not anyone's).
 */
type Case = readonly [text: string, kinds: readonly FindingKind[]];

const PHONES: Case[] = [
  // Kenyan mobiles, local spellings.
  ["Call me on 0712345678", ["phone"]],
  ["0712 345 678", ["phone"]],
  ["0712 345678", ["phone"]],
  ["07 12 34 56 78", ["phone"]],
  ["0712-345-678", ["phone"]],
  ["0712.345.678", ["phone"]],
  ["(0712) 345 678", ["phone"]],
  ["0712 - 345 - 678", ["phone"]],
  ["0110 123 456 is my other line", ["phone"]],
  ["Airtel: 0733-111-222", ["phone"]],
  ["Tel:0712345678", ["phone"]],
  ["WhatsApp me 0712 345 678.", ["phone"]],
  ["**0712345678**", ["phone"]],
  ["`0712345678`", ["phone"]],
  ["Call 0712345678, thanks", ["phone"]],
  ["Reach Achieng on 0722 000 111 or Brian on 0733 222 444", ["phone"]],
  ["Cohort 04 0712345678", ["phone"]],
  ["Text me after 2025: 0712345678", ["phone"]],
  // With the country code.
  ["+254 712 345 678", ["phone"]],
  ["+254712345678", ["phone"]],
  ["254712345678", ["phone"]],
  ["254 712 345 678", ["phone"]],
  ["+254 (0) 712 345 678", ["phone"]],
  ["+254-712-345-678", ["phone"]],
  ["+254.712.345.678", ["phone"]],
  ["+ 254 712 345 678", ["phone"]],
  ["(+254) 712345678", ["phone"]],
  ["00254712345678", ["phone"]],
  ["00 254 712 345 678", ["phone"]],
  // Landlines.
  ["Office: 020 2345678", ["phone"]],
  ["041-2345678", ["phone"]],
  // Spelled out, in English and Swahili, and mixed.
  ["zero seven one two three four five six seven eight", ["phone"]],
  ["sifuri saba moja mbili tatu nne tano sita saba nane", ["phone"]],
  ["07 one two 345 678", ["phone"]],
  ["0seven12 345 678", ["phone"]],
  ["zero-seven-one-two-three-four-five-six-seven-eight", ["phone"]],
  ["zero double seven one 234 567", ["phone"]],
  ["oh seven one two three four five six seven eight", ["phone"]],
  ["O712345678", ["phone"]],
  // Disguised characters.
  ["０７１２３４５６７８", ["phone"]],
  ["0️⃣7️⃣1️⃣2️⃣3️⃣4️⃣5️⃣6️⃣7️⃣8️⃣", ["phone"]],
  ["07\u200B12\u200B345\u200B678", ["phone"]],
  ["0712\u2013345\u2013678", ["phone"]],
  // International.
  ["+44 20 7946 0958", ["phone"]],
  ["+1 (555) 234-5678", ["phone"]],
  ["(555) 234-5678", ["phone"]],
  ["1 555 234 5678", ["phone"]],
  ["+255 754 123 456 for Dar", ["phone"]],
  ["+256 772 123456", ["phone"]],
  ["0044 20 7946 0958", ["phone"]],
  ["Namba yangu ni 0798 765 432", ["phone"]],
  ["Nipigie 0700-123-456 jioni", ["phone"]],
  ["My number (Safaricom): 0745.678.901", ["phone"]],
];

const EMAILS: Case[] = [
  ["email me wanjiku@gmail.com", ["email"]],
  ["Wanjiku.Kamau+ttv@outlook.com", ["email"]],
  ["write to brian_k@company.co.ke.", ["email"]],
  ["wanjiku [at] gmail [dot] com", ["email"]],
  ["wanjiku(at)gmail(dot)com", ["email"]],
  ["wanjiku [at] mycompany [dot] co [dot] ke", ["email"]],
  ["wanjiku at gmail dot com", ["email"]],
  ["wanjiku at yahoo.com", ["email"]],
  ["wanjiku @ gmail.com", ["email"]],
  ["wanjiku@ gmail.com", ["email"]],
  ["ＷＡＮＪＩＫＵ@ＧＭＡＩＬ.ＣＯＭ", ["email"]],
  ["jane dot doe at gmail dot com", ["email"]],
  ["jane[dot]doe(at)example(dot)co(dot)ke", ["email"]],
];

const LINKS: Case[] = [
  ["join chat.whatsapp.com/AbCdEf123", ["invite"]],
  ["https://chat.whatsapp.com/AbCdEf123", ["invite"]],
  ["https://wa.me/254712345678", ["invite"]],
  ["wa.me/message/ABCDEF", ["invite"]],
  ["api.whatsapp.com/send?phone=254712345678", ["invite"]],
  ["https://whatsapp.com/channel/0029VaAbCd", ["invite"]],
  ["wa.link/ttv04", ["invite"]],
  ["t.me/ttvcohort", ["invite"]],
  ["https://t.me/+AbCdEf123", ["invite"]],
  ["telegram.me/ttvcohort", ["invite"]],
  ["tg://resolve?domain=ttvcohort", ["invite"]],
  ["wa . me / 254712345678", ["invite", "phone"]],
  ["wa[.]me/abc", ["invite"]],
  ["chat(dot)whatsapp(dot)com/AbCd", ["invite"]],
  ["see bit.ly/3xYz", ["shortener"]],
  ["https://tinyurl.com/abc123", ["shortener"]],
  ["t.co/AbC12", ["shortener"]],
  ["Slides: cutt.ly/ttv-slides", ["shortener"]],
  ["www.rb.gy/abcd", ["shortener"]],
];

const MENTIONS: Case[] = [
  ["@Amina @Brian @Collins @David @Esther please read this", ["mentions"]],
  ["@Amina @Brian @Collins @David @Esther @Faith @Grace", ["mentions"]],
];

/** Everyday text that looks like a number, an address or a link, and must stay unflagged. */
const ORDINARY: Case[] = [
  // Years, dates and times.
  ["2019 2020 2021 2022", []],
  ["Cohort 04 starts 2025-11-03 at 10:30", []],
  ["Meet on 31/10/2025 at 07:45", []],
  ["07/11/2025 10:30", []],
  ["31.10.2025 07:12", []],
  ["Sessions run 2024-2025 and 2025-2026", []],
  ["10am-12pm on Saturday", []],
  ["0712hrs is too early", []],
  ["From 18:00 to 21:30 EAT", []],
  // Prices and quantities.
  ["KSh 1,500,000", []],
  ["Fees are KES 15000 per month", []],
  ["Budget: 2,500,000 shillings", []],
  ["Ksh.1500 or $12.99", []],
  ["50% of 1200 is 600", []],
  ["We raised 1 500 000 shillings", []],
  ["Population 54027487 in 2024", []],
  ["I scored 700 800 900", []],
  // Cohort numbers, rooms and ids.
  ["Cohort 04 and cohort 05 share c04-help", []],
  ["Room 0712", []],
  ["Order 1234567890", []],
  ["PR #283 merged", []],
  ["Ticket TTV-2025-0412", []],
  ["M-Pesa till 123456", []],
  // Versions, code and addresses.
  ["Node 20.11.1 and v1.2.3", []],
  ["Python 3.12.0, Astro 6.0.1, React 18.3.1", []],
  ["Build 10.0.19041.1234", []],
  ["192.168.100.200", []],
  ["localhost:4321", []],
  ["C++ 2024 2025 2026", []],
  ["1+1 = 2", []],
  ["const x = 0712345", []],
  ["git@github.com:tembo/ttv.git", []],
  ["test@example.com", []],
  ["Use name@example.org in the docs", []],
  ["@types/node 20.11", []],
  // Mentions and prose.
  ["Thanks @Achieng. Great work", []],
  ["@Amina @Brian thanks for the review", []],
  ["@Amina @Brian @Collins @David", []],
  ["@tembo @Amina @Brian @Collins @David", []],
  ["look at github dot com", []],
  ["We met at Nairobi dot org", []],
  ["Siku moja tutakutana", []],
  ["one or two people, three at most", []],
  // Links that are not invitations or shorteners.
  ["orbit.ly/abc", []],
  ["at.me/x", []],
  ["wa.me", []],
  ["https://github.com/tembo/ttv/pull/283", []],
  ["https://youtu.be/dQw4w9WgXcQ", []],
  ["https://tembotechventures.com/dashboard/community", []],
  ["whatsapp.com is down again", []],
  ["telegram.org/apps", []],
  // Digits in links, after a mark, or after "0." are not phone numbers.
  ["https://www.youtube.com/watch?v=0712345678", []],
  ["https://github.com/tembo/ttv/commit/0712345678", []],
  ["youtube.com/watch?v=0712345678", []],
  ["Order #0712345678", []],
  ["score 0.712345678", []],
  ["Paid $0712345678 lol", []],
  ["https://docs.astro.build/en/guides/upgrade-to/v6/", []],
  ["Release 2025.10.31.1 is live", []],
  ["IP 10.0.0.1 port 8080", []],
  ["Week 1-2-3 recap", []],
  ["Score: 3-1, then 2-0", []],
  ["Tuonane saa nne asubuhi", []],
];

const TABLE: Case[] = [...PHONES, ...EMAILS, ...LINKS, ...MENTIONS, ...ORDINARY];
const KINDS: FindingKind[] = ["phone", "email", "invite", "shortener", "mentions"];

const kindsIn = (text: string) => new Set(detectFindings(text).map((finding) => finding.kind));

describe("detector fixture table", () => {
  it("is large and covers both directions for every kind", () => {
    expect(TABLE.length).toBeGreaterThanOrEqual(140);
    expect(ORDINARY.length).toBeGreaterThanOrEqual(50);
    for (const kind of KINDS) expect(TABLE.some(([, kinds]) => kinds.includes(kind)), `${kind}`).toBe(true);
  });

  it.each(KINDS)("%s: precision and recall are both 1 on the table", (kind) => {
    const missed: string[] = [];
    const wrong: string[] = [];
    let found = 0;
    for (const [text, kinds] of TABLE) {
      const expected = kinds.includes(kind);
      const actual = kindsIn(text).has(kind);
      if (expected && actual) found += 1;
      else if (expected) missed.push(text);
      else if (actual) wrong.push(text);
    }
    const precision = found / (found + wrong.length);
    const recall = found / (found + missed.length);
    expect({ precision, recall, missed, wrong }).toEqual({ precision: 1, recall: 1, missed: [], wrong: [] });
  });

  it("finds nothing more than the table expects in any row", () => {
    const unexpected = TABLE.filter(([text, kinds]) => [...kindsIn(text)].some((kind) => !kinds.includes(kind)));
    expect(unexpected).toEqual([]);
  });
});

describe("known limits", () => {
  /**
   * What the detectors deliberately miss or catch, written down so a change is a decision. Clef sees
   * every message after it is posted and asks about contact details too, so these are not open doors.
   */
  const KNOWN_LIMITS: Case[] = [
    // Missed: a Kenyan number without its trunk zero reads like any list of numbers ("700 800 900").
    ["712 345 678", []],
    // Missed: commas between spelled digits end the run, like the commas of 1,500,000.
    ["zero, seven, one, two, three, four, five, six, seven, eight", []],
    // Missed: digit words beyond nought to nine.
    ["oh seven twelve three four five six seven eight", []],
    // Flagged although it is not a phone number: a hyphenated ISBN-10 starting with 0.
    ["ISBN 0-13-468599-1", ["phone"]],
    // Missed: a Kenyan number glued to a hash or after "0." (read as an id or a decimal).
    ["#0712345678", []],
    // Flagged: digits in a link without a scheme, after a slash and a word.
    ["github.com/tembo/ttv/commit/0712345678", ["phone"]],
  ];
  it.each(KNOWN_LIMITS)("%s", (text, kinds) => {
    expect([...kindsIn(text)]).toEqual(kinds);
  });
});

describe("finding keys", () => {
  it("gives every spelling of one Kenyan number the same key", () => {
    const spellings = ["0712345678", "0712 345 678", "+254 712 345 678", "254712345678", "+254 (0) 712-345-678",
      "00254712345678", "zero seven one two three four five six seven eight", "０７１２３４５６７８", "wa . me / 254712345678"];
    for (const text of spellings) {
      expect(detectFindings(text).filter((f) => f.kind === "phone").map((f) => f.key), `${text}`).toEqual(["phone:+254712345678"]);
    }
  });

  it("normalises emails and links, and keeps one finding per key", () => {
    expect(detectFindings("jane dot doe at gmail dot com").map((f) => f.key)).toEqual(["email:jane.doe@gmail.com"]);
    expect(detectFindings("Wanjiku [at] Gmail [dot] com or wanjiku@gmail.com").map((f) => f.key)).toEqual(["email:wanjiku@gmail.com"]);
    expect(detectFindings("wa . me / 254712345678 and https://wa.me/254712345678.").map((f) => f.key))
      .toEqual(["phone:+254712345678", "link:wa.me/254712345678"]);
    expect(detectFindings("0712345678 and 0733222444").map((f) => f.key)).toEqual(["phone:+254712345678", "phone:+254733222444"]);
  });

  it("states each reason in plain language, and gives whole-text patterns no key", () => {
    const [flood] = detectFindings(Array.from({ length: MENTION_FLOOD }, (_, i) => `@person${i}`).join(" "));
    expect(flood).toEqual({ kind: "mentions", reason: FINDING_REASONS.mentions, key: null });
    expect(detectFindings("bit.ly/x1")).toEqual([{ kind: "shortener", reason: "Uses a shortened link", key: "link:bit.ly/x1" }]);
  });
});

describe("textKey", () => {
  it("ignores case, Unicode forms and spacing, and nothing else", async () => {
    const key = await textKey("Call Wanjiku on 0712 345 678");
    expect(key).toMatch(/^text:[0-9a-f]{64}$/);
    expect(await textKey("  call WANJIKU\non ０７１２ 345   678 ")).toBe(key);
    expect(await textKey("Call Wanjiku on 0712 345 679")).not.toBe(key);
  });
});
