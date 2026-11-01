/**
 * The deterministic, synchronous screen (plan §3 "Moderation pipeline", step 1): contact details
 * and spam patterns that a person should look at. A finding never hides a message or refuses a post:
 * the message is stored FLAGGED with the finding's reason and stays visible until someone decides
 * (owner decision 2, 2026-10-31). Pure functions, no I/O: the allowlist and the cross-channel repeat
 * check run in SQL beside the write (mutations.ts), so a refused write does no extra work.
 *
 * Precision matters as much as recall here: phone-shaped numbers are everywhere (years, prices,
 * cohort numbers, times, versions), so a digit run only counts as a phone number when it starts and
 * ends on the boundaries the author typed and has a phone number's shape. The fixture table in
 * detectors.test.ts measures both.
 */

export type FindingKind = "phone" | "email" | "invite" | "shortener" | "mentions";

/** Plain-language reasons, shown to the author and to moderators. */
export const FINDING_REASONS: Readonly<Record<FindingKind | "repeat", string>> = Object.freeze({
  phone: "Shares a phone number",
  email: "Shares an email address",
  invite: "Links to a WhatsApp or Telegram chat",
  shortener: "Uses a shortened link",
  mentions: "Mentions many people at once",
  repeat: "Posted the same message in several channels",
});

export interface Finding {
  kind: FindingKind;
  reason: string;
  /**
   * What an admin's "fine as is" allowlists, normalised so other spellings match: `phone:+254712345678`,
   * `email:…`, `link:host/path`. Null for patterns of the whole text (mention floods), which only the
   * text's own key (textKey) allowlists.
   */
  key: string | null;
}

/** Distinct people mentioned before a message counts as a mention flood. */
export const MENTION_FLOOD = 5;

/**
 * Same text in this many channels (counting the new one) within the window flags the newest copy.
 * Short texts ("thanks!", "hi all") are ordinary in several channels and never count.
 */
export const REPEAT = Object.freeze({ channels: 3, windowMs: 60 * 60_000, minLength: 20 });

/** Every finding in a message body, one per allowlist key, in order of appearance by kind. */
export function detectFindings(body: string): Finding[] {
  const text = normalise(body);
  const findings = [...phoneFindings(text), ...emailFindings(text), ...linkFindings(text), ...mentionFindings(text)];
  const seen = new Set<string>();
  return findings.filter((finding) => {
    const id = finding.key ?? finding.kind;
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * The allowlist key of a whole message text: an admin keeping a message allowlists this, so the same
 * words are never flagged again (by the detectors, the repeat check or Clef). Case, Unicode forms and
 * spacing do not change it.
 */
export async function textKey(body: string): Promise<string> {
  const canonical = normalise(body).toLowerCase().replace(/\s+/g, " ").trim();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  return `text:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

/** Fullwidth and other compatibility forms, keycap emoji, invisible characters and Unicode dashes. */
function normalise(body: string): string {
  return body.normalize("NFKC")
    .replace(/[\uFE0F\u20E3\u200B-\u200D\u2060\uFEFF\u00AD]/g, "")
    .replace(/[\u2010-\u2015\u2212]/g, "-");
}

// ─── Phone numbers ─────────────────────────────────────────────────────────

/** Spelled-out digits in English and Swahili. */
const DIGIT_WORDS: Readonly<Record<string, string>> = Object.freeze({
  zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4", five: "5", six: "6", seven: "7", eight: "8", nine: "9",
  sifuri: "0", moja: "1", mbili: "2", tatu: "3", nne: "4", tano: "5", sita: "6", saba: "7", nane: "8", tisa: "9",
});
const MULTIPLIERS: Readonly<Record<string, number>> = Object.freeze({ double: 2, triple: 3 });
/** Characters that may sit between the groups of one phone number: "0712 345 678", "+254-712.345.678", "(0712)". */
const SEPARATORS = new Set([" ", "\t", ".", "-", "(", ")"]);
/** Between two digit groups these make one number of another kind: 10:30, 1,500,000, 31/10/2025. */
const NUMBER_JOINERS = new Set([":", ",", "/"]);
/** The longest separator run inside a phone number, such as ") - ". */
const MAX_SEPARATOR = 4;

type Lexeme = { kind: "digits" | "word" | "space" | "char"; text: string };
type Atom =
  | { kind: "digits"; text: string; excluded: boolean }
  | { kind: "separator"; text: string } | { kind: "plus" } | { kind: "word" } | { kind: "joiner" } | { kind: "break" };
/** tight: joined to the previous group by one "." or "-" with nothing else between (10.0.19041, 07-12-34). */
interface Group { digits: string; plus: boolean; tight: boolean }

function lex(text: string): Lexeme[] {
  const lexemes: Lexeme[] = [];
  for (const [, digits, word, space, char] of text.matchAll(/(\d+)|([\p{L}\p{M}]+)|([ \t]+)|([\s\S])/gu)) {
    if (digits !== undefined) lexemes.push({ kind: "digits", text: digits });
    else if (word !== undefined) lexemes.push({ kind: "word", text: word });
    else if (space !== undefined) lexemes.push({ kind: "space", text: space });
    else lexemes.push({ kind: "char", text: char ?? "" });
  }
  return lexemes;
}

/** The digits a lexeme stands for: digits, a digit word, or a letter O written straight against digits. */
function digitsOf(lexemes: Lexeme[], i: number): string | null {
  const lexeme = lexemes[i];
  if (lexeme?.kind === "digits") return lexeme.text;
  if (lexeme?.kind !== "word") return null;
  const word = lexeme.text.toLowerCase();
  if (DIGIT_WORDS[word] !== undefined) return DIGIT_WORDS[word];
  if (word === "o" && (lexemes[i - 1]?.kind === "digits" || lexemes[i + 1]?.kind === "digits")) return "0";
  return null;
}

/** "double seven": how many times the next digit counts, when this word multiplies one digit after one space. */
function multiplier(lexemes: Lexeme[], i: number): number {
  const times = MULTIPLIERS[lexemes[i]?.text.toLowerCase() ?? ""];
  const next = lexemes[i + 1]?.kind === "space" ? i + 2 : i + 1;
  return times !== undefined && digitsOf(lexemes, next)?.length === 1 ? times : 1;
}

function charAtom(char: string): Atom {
  if (char === "+") return { kind: "plus" };
  if (SEPARATORS.has(char)) return { kind: "separator", text: char };
  return { kind: NUMBER_JOINERS.has(char) ? "joiner" : "break" };
}

/**
 * Digits written against letters (v2, 10am, KSh500) or joined to other digits by : , / (times,
 * thousands, dates) are some other number.
 */
function excludeOtherNumbers(list: Atom[]): void {
  const joined = (i: number, step: 1 | -1) => list[i + step]?.kind === "joiner" && list[i + 2 * step]?.kind === "digits";
  for (const [i, atom] of list.entries()) {
    if (atom.kind !== "digits") continue;
    if (list[i - 1]?.kind === "word" || list[i + 1]?.kind === "word" || joined(i, -1) || joined(i, 1)) atom.excluded = true;
  }
}

/** The text as phone-number atoms: digit groups (spelled ones included) and what lies between them. */
function atoms(text: string): Atom[] {
  const lexemes = lex(text);
  const result: Atom[] = [];
  // A multiplier applies to the next digit, across one space.
  let repeat = 1;
  for (const [i, lexeme] of lexemes.entries()) {
    const digits = digitsOf(lexemes, i);
    if (digits !== null) {
      result.push({ kind: "digits", text: digits.repeat(repeat), excluded: false });
      repeat = 1;
    } else if (lexeme.kind === "space") {
      result.push(lexeme.text.length <= MAX_SEPARATOR ? { kind: "separator", text: " " } : { kind: "break" });
    } else if (lexeme.kind === "word") {
      repeat = multiplier(lexemes, i);
      result.push(repeat > 1 ? { kind: "separator", text: " " } : { kind: "word" });
    } else {
      repeat = 1;
      result.push(charAtom(lexeme.text));
    }
  }
  excludeOtherNumbers(result);
  return result;
}

/** Runs of digit groups that only phone separators keep apart. A "+" starts a new run. */
function runs(text: string): Group[][] {
  const all: Group[][] = [];
  let run: Group[] = [];
  let separators = 0;
  let plus = false;
  const tightMarks = new Set([".", "-"]);
  const flush = () => {
    if (run.length > 0) all.push(run);
    run = [];
    separators = 0;
  };
  const list = atoms(text);
  for (const [i, atom] of list.entries()) {
    const previous = list[i - 1];
    if (atom.kind === "digits" && !atom.excluded) {
      const last = run.at(-1);
      // Digits written straight against digits (07one2) are one group.
      if (last && previous?.kind === "digits") last.digits += atom.text;
      else {
        const tight = previous?.kind === "separator" && tightMarks.has(previous.text) && list[i - 2]?.kind === "digits";
        run.push({ digits: atom.text, plus, tight });
      }
      plus = false;
      separators = 0;
    } else if (atom.kind === "separator") {
      separators += 1;
      if (separators > MAX_SEPARATOR) flush();
    } else if (atom.kind === "plus") {
      flush();
      // Only a plus that starts something is a country code: not C++, 1+1 or ++.
      plus = previous === undefined || previous.kind === "separator" || previous.kind === "break";
    } else {
      flush();
      plus = false;
    }
  }
  flush();
  return all;
}

/**
 * The canonical form of a phone number written as these groups, or null when they are not one.
 * Kenyan numbers in every spelling become +254 and nine digits.
 */
function phoneNumber(groups: Group[]): string | null {
  const digits = groups.map((group) => group.digits).join("");
  const shape = groups.map((group) => group.digits.length).join("-");
  const kenyan = (national: string) => `+254${national}`;
  if (groups[0]?.plus) {
    if (digits.startsWith("254")) return /^2540?[1-9]\d{8}$/.test(digits) ? kenyan(digits.replace(/^2540?/, "")) : null;
    return digits.length >= 10 && digits.length <= 15 && !digits.startsWith("0") ? `+${digits}` : null;
  }
  if (/^00[1-9]\d{8,12}$/.test(digits)) return phoneNumber([{ digits: digits.slice(2), plus: true, tight: false }]);
  if (/^2540?[1-9]\d{8}$/.test(digits)) return kenyan(digits.replace(/^2540?/, ""));
  // A trunk zero: Kenyan mobiles and landlines (07xx, 01xx, 020), and other national numbers.
  if (/^0[1-9]\d{8}$/.test(digits)) return kenyan(digits.slice(1));
  if (/^0[1-9]\d{9}$/.test(digits)) return digits;
  // Without a trunk zero only in the North American grouping, (555) 234-5678. A Kenyan number without
  // its 0 (712 345 678) reads like any list of numbers, so it is left to Clef.
  if ((shape === "3-3-4" || shape === "1-3-3-4") && /^1?[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return `+1${digits.slice(-10)}`;
  return null;
}

function phoneFindings(text: string): Finding[] {
  const findings: Finding[] = [];
  for (const run of runs(text)) {
    let start = 0;
    while (start < run.length) {
      // The longest number that starts at this group and ends at a group boundary. A tightly joined
      // chain (10.0.19041.1234) is one number: a phone number never starts or ends inside it.
      let match: { end: number; number: string } | null = null;
      let length = 0;
      for (let end = start; end < run.length && length <= 16 && !run[start]?.tight; end += 1) {
        length += run[end]?.digits.length ?? 0;
        const number = length <= 16 && !run[end + 1]?.tight ? phoneNumber(run.slice(start, end + 1)) : null;
        if (number) match = { end, number };
      }
      if (match) {
        findings.push({ kind: "phone", reason: FINDING_REASONS.phone, key: `phone:${match.number}` });
        start = match.end + 1;
      } else {
        start += 1;
      }
    }
  }
  return findings;
}

// ─── Email addresses ───────────────────────────────────────────────────────

const LOCAL = String.raw`[a-z0-9](?:[a-z0-9._%+-]{0,62}[a-z0-9])?`;
const LABEL = String.raw`[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?`;
const TLD = String.raw`[a-z]{2,24}`;
/** "." written plainly or hidden: [.], (dot), " dot ". */
const DOT = String.raw`(?:\s?\.\s?|\s?[\[(]\s?(?:dot|\.)\s?[\])]\s?|\s+dot\s+)`;
const DOMAIN = `(${LABEL}(?:${DOT}${LABEL})*${DOT}${TLD})`;
/** Webmail providers. "name at gmail dot com" counts only for these: "look at github dot com" is prose. */
const PROVIDERS = String.raw`(?:gmail|googlemail|yahoo|ymail|outlook|hotmail|live|icloud|me|proton|protonmail|pm|aol|zoho|gmx|mail|yandex)`;
const STRICT_DOMAIN = String.raw`(${LABEL}(?:\.${LABEL})*\.${TLD})`;
const PROVIDER_DOMAIN = String.raw`(${PROVIDERS}(?:\s+dot\s+|\s?\.\s?)${TLD}(?:(?:\s+dot\s+|\s?\.\s?)${TLD})?)`;
const EMAILS = [
  // name@example.org
  new RegExp(String.raw`(?<![\w.%+-])(${LOCAL})@${STRICT_DOMAIN}(?![\w-])`, "giu"),
  // name[at]example.org, name (at) example (dot) org: hidden on purpose, so any domain.
  new RegExp(String.raw`(?<![\w.%+-])(${LOCAL})\s?[\[({]\s?(?:at|@)\s?[\])}]\s?${DOMAIN}(?![\w-])`, "giu"),
  // name @ gmail.com, name at gmail dot com: only webmail domains, since "thanks @Achieng. Great" and
  // "look at github dot com" are prose.
  new RegExp(String.raw`(?<![\w.%+-])(${LOCAL})(?:\s@\s?|@\s|\s+at\s+)${PROVIDER_DOMAIN}(?![\w-])`, "giu"),
];
/** Documentation and protocol addresses that reach nobody (RFC 2606), and git's SSH user. */
const NOT_CONTACT = /(?:^|\.)(?:example\.(?:com|org|net)|example|test|invalid|localhost|users\.noreply\.github\.com)$/;

function emailFindings(text: string): Finding[] {
  const findings: Finding[] = [];
  for (const pattern of EMAILS) {
    for (const [, local = "", rawDomain = ""] of text.matchAll(pattern)) {
      const domain = rawDomain.toLowerCase().replace(new RegExp(DOT, "giu"), ".");
      if (NOT_CONTACT.test(domain) || local.toLowerCase() === "git") continue;
      findings.push({ kind: "email", reason: FINDING_REASONS.email, key: `email:${local.toLowerCase()}@${domain}` });
    }
  }
  return findings;
}

// ─── Links ─────────────────────────────────────────────────────────────────

/** Chat invitations that take a conversation out of TTV (owner decision 6: no WhatsApp bridge). */
const INVITES = [
  "chat.whatsapp.com", "wa.me", "wa.link", "api.whatsapp.com/send", "web.whatsapp.com/send", "whatsapp.com/channel",
  "t.me", "telegram.me", "telegram.dog",
];
/** Shorteners hide where a link goes. youtu.be and similar first-party short domains are not here. */
const SHORTENERS = [
  "bit.ly", "bit.do", "tinyurl.com", "t.co", "goo.gl", "ow.ly", "is.gd", "v.gd", "buff.ly", "cutt.ly", "rebrand.ly",
  "shorturl.at", "rb.gy", "tiny.cc", "tiny.one", "bl.ink", "lnkd.in", "s.id", "t.ly", "short.gy", "shorte.st",
  "adf.ly", "qrco.de", "smarturl.it", "trib.al", "dlvr.it", "ift.tt",
];
/** A host (with an optional path prefix) whose dots may be written hidden, as above. */
const hostPattern = (target: string) => target.split("/").map((part, i) => i === 0
  ? part.split(".").map((label) => label.replace(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`)).join(DOT)
  : part).join(String.raw`\s?/\s?`);
/** The target, then a path or query with at least one character: wa.me/2547…, api.whatsapp.com/send?phone=… */
const linkPattern = (targets: string[]) => new RegExp(String.raw`(?<![\w.@/-])(?:https?:\/\/)?(?:www${DOT})?`
  + `(${targets.map(hostPattern).join("|")})` + String.raw`\s?([/?#])\s?([\w+-][\w+\-./?=&%#~]*)`, "giu");
const LINKS: [FindingKind, RegExp][] = [["invite", linkPattern(INVITES)], ["shortener", linkPattern(SHORTENERS)]];
/** App links open the chat directly. */
const APP_LINKS = /(?<![\w-])(whatsapp|tg):\/\/([\w+\-./?=&%#~]+)/giu;

function linkKey(host: string, mark: string, path: string): string {
  const canonicalHost = host.toLowerCase().replace(new RegExp(DOT, "giu"), ".").replace(/\s/g, "");
  return `link:${canonicalHost}${mark}${path.replace(/[.?!,]+$/, "")}`;
}

function linkFindings(text: string): Finding[] {
  const findings: Finding[] = [];
  for (const [kind, pattern] of LINKS) {
    for (const [, host = "", mark = "", path = ""] of text.matchAll(pattern)) {
      findings.push({ kind, reason: FINDING_REASONS[kind], key: linkKey(host, mark, path) });
    }
  }
  for (const [, scheme = "", path = ""] of text.matchAll(APP_LINKS)) {
    findings.push({ kind: "invite", reason: FINDING_REASONS.invite, key: `link:${scheme.toLowerCase()}://${path}` });
  }
  return findings;
}

// ─── Mentions ──────────────────────────────────────────────────────────────

/** `@Name` as the composer writes it (src/components/channels/mentions.ts). Tembo is not a person. */
const MENTION = /(?:^|[\s([{])@([\p{L}\p{N}_'’-]+)/gu;

function mentionFindings(text: string): Finding[] {
  const people = new Set([...text.matchAll(MENTION)].map(([, name = ""]) => name.toLowerCase()).filter((name) => name !== "tembo"));
  return people.size >= MENTION_FLOOD ? [{ kind: "mentions", reason: FINDING_REASONS.mentions, key: null }] : [];
}
