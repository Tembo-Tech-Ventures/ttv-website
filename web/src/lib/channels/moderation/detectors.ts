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

/** Where something sits in a body as written: [start, end) in UTF-16 code units. */
export type Span = readonly [start: number, end: number];
/** Every occurrence of a finding, with where it is; a pattern of the whole text has no span. */
type Located = Finding & { span: Span | null };

/** Every finding in a message body, one per allowlist key, in order of appearance by kind. */
export function detectFindings(body: string): Finding[] {
  const seen = new Set<string>();
  return locatedFindings(body).flatMap(({ kind, reason, key }) => {
    const id = key ?? kind;
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ kind, reason, key }];
  });
}

function locatedFindings(body: string): Located[] {
  const text = normaliseMapped(body);
  return [...phoneFindings(text), ...emailFindings(text), ...linkFindings(text), ...mentionFindings(text.text)];
}

/** Findings that share a way to reach someone outside TTV: phone numbers, email addresses and chat invitations. */
const CONTACT_KINDS: ReadonlySet<FindingKind> = new Set(["phone", "email", "invite"]);
/** The stored reasons of those findings: a FLAGGED message with one of these is masked for other readers (QA2-08). */
export const CONTACT_REASONS: ReadonlySet<string> = new Set([...CONTACT_KINDS].map((kind) => FINDING_REASONS[kind]));

/**
 * Where a body shares contact details or chat invitations, every occurrence, in order, with
 * overlapping spans merged. Read paths recompute this (it is linear, like the screen) rather than
 * store offsets, so an edit that removes a number unmasks the rest at once.
 */
export function contactSpans(body: string): Span[] {
  const spans = locatedFindings(body).flatMap(({ kind, span }) => span && CONTACT_KINDS.has(kind) ? [span] : [])
    .toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged: [number, number][] = [];
  for (const [start, end] of spans) {
    const last = merged.at(-1);
    if (last && start <= last[1]) last[1] = Math.max(last[1], end);
    else merged.push([start, end]);
  }
  return merged;
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

/** Text the detectors read, and for each of its UTF-16 units the range of the body it came from. */
interface Mapped { text: string; from: number[]; to: number[] }

/**
 * normalise(), one base character and its marks at a time, so each piece of the result maps back to
 * the characters it came from. Composition happens within those pieces, which covers every
 * character the contact patterns read (rare scripts such as conjoining Hangul jamo may read
 * differently). A run of ASCII that no mark follows is already normal, so it maps one to one
 * without normalising: reads recompute this for flagged messages (mask.ts), and most text is ASCII.
 * Which alternative matched decides it, never the chunk's last UTF-16 unit, which for a mark outside
 * the BMP (U+1D16D) is half a surrogate pair.
 */
function normaliseMapped(body: string): Mapped {
  const mapped: Mapped = { text: "", from: [], to: [] };
  for (const { 0: chunk, 1: asciiRun, index } of body.matchAll(/([\0-\x7F]+)(?!\p{M})|[\s\S]\p{M}*/gu)) {
    const ascii = asciiRun !== undefined;
    const piece = ascii ? chunk : normalise(chunk);
    mapped.text += piece;
    for (let unit = 0; unit < piece.length; unit += 1) {
      mapped.from.push(ascii ? index + unit : index);
      mapped.to.push(ascii ? index + unit + 1 : index + chunk.length);
    }
  }
  return mapped;
}

/** Where [start, end) of the mapped text lies in the body. */
const locate = (mapped: Mapped, start: number, end: number): Span => [mapped.from[start] ?? 0, mapped.to[end - 1] ?? 0];

/** text.replace(LINK_PATH, "$1 "), keeping the map: the space stands for the path it replaced. */
function withoutLinkPaths(mapped: Mapped): Mapped {
  const result: Mapped = { text: "", from: [], to: [] };
  const copy = (start: number, end: number) => {
    result.text += mapped.text.slice(start, end);
    for (let unit = start; unit < end; unit += 1) {
      result.from.push(mapped.from[unit] ?? 0);
      result.to.push(mapped.to[unit] ?? 0);
    }
  };
  let last = 0;
  for (const { 0: link, 1: host = "", index } of mapped.text.matchAll(LINK_PATH)) {
    copy(last, index + host.length);
    result.text += " ";
    result.from.push(mapped.from[index + host.length] ?? 0);
    result.to.push(mapped.to[index + link.length - 1] ?? 0);
    last = index + link.length;
  }
  copy(last, mapped.text.length);
  return result;
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
/** Digits straight after these are an amount ($100), or a number of something when a word names it (Order #0712…). */
const NUMBER_MARKS = new Set(["#", "$"]);
/**
 * The path and query of a link to a named host (example.com/…/0712…?v=0712…): ids, not phone numbers.
 * The host stays, and a "link" whose host is digits (www.0712345678) is no link. Invitation links are
 * their own finding. A host starts only where a run of letters, digits, dots and hyphens starts, so
 * one long run is scanned once, not once from each of its characters.
 */
const LINK_PATH = /((?:https?:\/\/)?(?<![a-z0-9.-])(?:[a-z0-9-]+\.)+[a-z]{2,24})[/?#][^\s<>"'`)\]|]*/giu;
/** The longest separator run inside a phone number, such as ") - ". */
const MAX_SEPARATOR = 4;

/** start: where the lexeme, atom or group starts in the text; end: just after it. */
interface Place { start: number; end: number }
type Lexeme = { kind: "digits" | "word" | "space" | "char"; text: string } & Place;
type AtomKind =
  | { kind: "digits"; text: string; excluded: boolean }
  | { kind: "separator"; text: string } | { kind: "plus" } | { kind: "word" } | { kind: "joiner" } | { kind: "mark"; text: string }
  | { kind: "break" };
type Atom = AtomKind & Place;
/** tight: joined to the previous group by one "." or "-" with nothing else between (10.0.19041, 07-12-34). */
interface Group extends Place { digits: string; plus: boolean; tight: boolean }

function lex(text: string): Lexeme[] {
  const lexemes: Lexeme[] = [];
  for (const { 0: whole, 1: digits, 2: word, 3: space, index: start } of text.matchAll(/(\d+)|([\p{L}\p{M}]+)|([ \t]+)|([\s\S])/gu)) {
    const kind = digits !== undefined ? "digits" : word !== undefined ? "word" : space !== undefined ? "space" : "char";
    lexemes.push({ kind, text: whole, start, end: start + whole.length });
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

/** A digit word, or "double"/"triple" before one: a number someone is spelling out. */
function spelled(lexemes: Lexeme[], i: number): boolean {
  return lexemes[i]?.kind === "word" && (digitsOf(lexemes, i) !== null || multiplier(lexemes, i) > 1);
}

/**
 * A comma beside a spelled digit, as in "oh seven two two, double zero zero, one one one", groups
 * a number read aloud rather than joining the digits of another kind of number (1,500,000), so it
 * separates groups like a space (QA2-09), with or without spaces around it. One look either side,
 * across one space: linear however long the text is.
 */
function spelledComma(lexemes: Lexeme[], i: number): boolean {
  const previous = lexemes[i - 1]?.kind === "space" ? i - 2 : i - 1;
  const next = lexemes[i + 1]?.kind === "space" ? i + 2 : i + 1;
  return lexemes[i]?.text === "," && (spelled(lexemes, previous) || spelled(lexemes, next));
}

function charAtom(char: string): AtomKind {
  if (char === "+") return { kind: "plus" };
  if (SEPARATORS.has(char)) return { kind: "separator", text: char };
  if (NUMBER_MARKS.has(char)) return { kind: "mark", text: char };
  return { kind: NUMBER_JOINERS.has(char) ? "joiner" : "break" };
}

/**
 * Some other number: digits written against letters (v2, 10am, KSh500), after $ or a named # in one
 * group (Order #0712…, PR #283), joined to other digits by : , / (times, thousands, dates), or a decimal (0.712345678,
 * a lone "0." and one group: "0.712 345 678" and "0.7.1.2…" stay phone-shaped).
 */
function excludeOtherNumbers(list: Atom[]): void {
  const joined = (i: number, step: 1 | -1) => list[i + step]?.kind === "joiner" && list[i + 2 * step]?.kind === "digits";
  const isSeparator = (i: number, text?: string) => {
    const at = list[i];
    return at?.kind === "separator" && (text === undefined || at.text === text);
  };
  // Digits that more groups follow, across separators only: "#0712 345 678" is grouped like a phone number.
  const grouped = (i: number) => {
    let next = i + 1;
    while (isSeparator(next) && next - i <= MAX_SEPARATOR) next += 1;
    return next > i + 1 && list[next]?.kind === "digits";
  };
  // "$100", or a single group numbering something a word names (Order #0712…, PR #283).
  const marked = (i: number) => {
    const mark = list[i - 1];
    if (mark?.kind !== "mark") return false;
    return mark.text === "$" || (isSeparator(i - 2, " ") && list[i - 3]?.kind === "word" && !grouped(i));
  };
  // "0." and one group that ends the number. The zero must not be inside a tight chain (10.0.712…).
  const decimal = (i: number) => {
    const zero = list[i - 2];
    const chained = (isSeparator(i - 3, ".") || isSeparator(i - 3, "-")) && list[i - 4]?.kind === "digits";
    const continues = isSeparator(i + 1) && list[i + 2]?.kind === "digits";
    return isSeparator(i - 1, ".") && zero?.kind === "digits" && zero.text === "0" && list[i - 3]?.kind !== "digits" && !chained && !continues;
  };
  for (const [i, atom] of list.entries()) {
    if (atom.kind !== "digits") continue;
    if (list[i - 1]?.kind === "word" || list[i + 1]?.kind === "word" || marked(i) || joined(i, -1) || joined(i, 1)) atom.excluded = true;
    const zero = list[i - 2];
    if (decimal(i) && zero?.kind === "digits") {
      zero.excluded = true;
      atom.excluded = true;
    }
  }
}

/** The text as phone-number atoms: digit groups (spelled ones included) and what lies between them. */
function atoms(text: string): Atom[] {
  const lexemes = lex(text);
  const result: Atom[] = [];
  // A multiplier applies to the next digit, across one space.
  let repeat = 1;
  for (const [i, lexeme] of lexemes.entries()) {
    const { start, end } = lexeme;
    const digits = digitsOf(lexemes, i);
    if (digits !== null) {
      result.push({ kind: "digits", text: digits.repeat(repeat), excluded: false, start, end });
      repeat = 1;
    } else if (lexeme.kind === "space") {
      // "double " is one separator, not two: the multiplier already stands for the space after it.
      if (repeat > 1) continue;
      result.push(lexeme.text.length <= MAX_SEPARATOR ? { kind: "separator", text: " ", start, end } : { kind: "break", start, end });
    } else if (lexeme.kind === "word") {
      repeat = multiplier(lexemes, i);
      result.push(repeat > 1 ? { kind: "separator", text: " ", start, end } : { kind: "word", start, end });
    } else if (spelledComma(lexemes, i)) {
      repeat = 1;
      result.push({ kind: "separator", text: ",", start, end });
    } else {
      repeat = 1;
      result.push({ ...charAtom(lexeme.text), start, end });
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
  // Where the "+" before the next group is, so a number's span starts at its country code.
  let plusAt = 0;
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
      if (last && previous?.kind === "digits") {
        last.digits += atom.text;
        last.end = atom.end;
      } else {
        const tight = previous?.kind === "separator" && tightMarks.has(previous.text) && list[i - 2]?.kind === "digits";
        run.push({ digits: atom.text, plus, tight, start: plus ? plusAt : atom.start, end: atom.end });
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
      plusAt = atom.start;
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
function phoneNumber(digits: string, shape: string, plus: boolean): string | null {
  const kenyan = (national: string) => `+254${national}`;
  if (plus) {
    if (digits.startsWith("254")) return /^2540?[1-9]\d{8}$/.test(digits) ? kenyan(digits.replace(/^2540?/, "")) : null;
    return digits.length <= 15 && !digits.startsWith("0") ? `+${digits}` : null;
  }
  // 00 and an international number of at least MIN_DIGITS digits.
  if (/^00[1-9]\d{9,13}$/.test(digits)) return phoneNumber(digits.slice(2), "", true);
  if (/^2540?[1-9]\d{8}$/.test(digits)) return kenyan(digits.replace(/^2540?/, ""));
  // A trunk zero: Kenyan mobiles and landlines (07xx, 01xx, 020), and other national numbers.
  if (/^0[1-9]\d{8}$/.test(digits)) return kenyan(digits.slice(1));
  if (/^0[1-9]\d{9}$/.test(digits)) return digits;
  // Without a trunk zero only in the North American grouping, (555) 234-5678. A Kenyan number without
  // its 0 (712 345 678) reads like any list of numbers, so it is left to Clef.
  if ((shape === "3-3-4" || shape === "1-3-3-4") && /^1?[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return `+1${digits.slice(-10)}`;
  return null;
}

/** Every phone rule needs at least this many digits, and none more than MAX_DIGITS. */
const MIN_DIGITS = 10;
const MAX_DIGITS = 16;

/** The longest phone number that starts at this group of a run and ends at a group boundary. */
function longestNumber(run: Group[], start: number): { end: number; number: string } | null {
  // A tightly joined chain (10.0.19041.1234) is one number: a phone number never starts or ends inside it.
  if (run[start]?.tight) return null;
  const plus = run[start]?.plus ?? false;
  let match: { end: number; number: string } | null = null;
  let digits = "";
  let shape = "";
  for (let end = start; end < run.length; end += 1) {
    const group = run[end]?.digits ?? "";
    digits += group;
    shape += `${shape ? "-" : ""}${group.length}`;
    // No phone number starts with 000, or with 0 after a plus.
    if (digits.length > MAX_DIGITS || digits.startsWith(plus ? "0" : "000")) break;
    const number = digits.length >= MIN_DIGITS && !run[end + 1]?.tight ? phoneNumber(digits, shape, plus) : null;
    if (number) match = { end, number };
  }
  return match;
}

function phoneFindings(mapped: Mapped): Located[] {
  const findings: Located[] = [];
  const text = withoutLinkPaths(mapped);
  for (const run of runs(text.text)) {
    let start = 0;
    while (start < run.length) {
      const match = longestNumber(run, start);
      if (match) {
        const span = locate(text, run[start]?.start ?? 0, run[match.end]?.end ?? 0);
        findings.push({ kind: "phone", reason: FINDING_REASONS.phone, key: `phone:${match.number}`, span });
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
/** A local part whose dots are spelled out or bracketed: jane dot doe, jane[dot]doe. */
const WORD_DOT = String.raw`(?:\s+dot\s+|\s?[\[(]\s?dot\s?[\])]\s?)`;
// At most three spelled dots, so each start position costs the same however long the text is.
const HIDDEN_LOCAL = `(${LOCAL}(?:${WORD_DOT}${LOCAL}){0,3})`;
const EMAILS = [
  // name@example.org
  new RegExp(String.raw`(?<![\w.%+-])(${LOCAL})@${STRICT_DOMAIN}(?![\w-])`, "giu"),
  // name[at]example.org, name (at) example (dot) org: hidden on purpose, so any domain.
  new RegExp(String.raw`(?<![\w.%+-])${HIDDEN_LOCAL}\s?[\[({]\s?(?:at|@)\s?[\])}]\s?${DOMAIN}(?![\w-])`, "giu"),
  // name @ gmail.com, name at gmail dot com: only webmail domains, since "thanks @Achieng. Great" and
  // "look at github dot com" are prose.
  new RegExp(String.raw`(?<![\w.%+-])${HIDDEN_LOCAL}(?:\s@\s?|@\s|\s+at\s+)${PROVIDER_DOMAIN}(?![\w-])`, "giu"),
];
/** Documentation and protocol addresses that reach nobody (RFC 2606), and git's SSH user. */
const NOT_CONTACT = /(?:^|\.)(?:example\.(?:com|org|net)|example|test|invalid|localhost|users\.noreply\.github\.com)$/;

function emailFindings(mapped: Mapped): Located[] {
  const findings: Located[] = [];
  for (const pattern of EMAILS) {
    for (const { 0: whole, 1: local = "", 2: rawDomain = "", index } of mapped.text.matchAll(pattern)) {
      const domain = rawDomain.toLowerCase().replace(new RegExp(DOT, "giu"), ".");
      if (NOT_CONTACT.test(domain) || local.toLowerCase() === "git") continue;
      const address = local.toLowerCase().replace(new RegExp(WORD_DOT, "giu"), ".");
      const span = locate(mapped, index, index + whole.length);
      findings.push({ kind: "email", reason: FINDING_REASONS.email, key: `email:${address}@${domain}`, span });
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

function linkFindings(mapped: Mapped): Located[] {
  const findings: Located[] = [];
  for (const [kind, pattern] of LINKS) {
    for (const { 0: whole, 1: host = "", 2: mark = "", 3: path = "", index } of mapped.text.matchAll(pattern)) {
      findings.push({ kind, reason: FINDING_REASONS[kind], key: linkKey(host, mark, path), span: locate(mapped, index, index + whole.length) });
    }
  }
  for (const { 0: whole, 1: scheme = "", 2: path = "", index } of mapped.text.matchAll(APP_LINKS)) {
    const span = locate(mapped, index, index + whole.length);
    findings.push({ kind: "invite", reason: FINDING_REASONS.invite, key: `link:${scheme.toLowerCase()}://${path}`, span });
  }
  return findings;
}

// ─── Mentions ──────────────────────────────────────────────────────────────

/** `@Name` as the composer writes it (src/components/channels/mentions.ts). Tembo is not a person. */
const MENTION = /(?:^|[\s([{])@([\p{L}\p{N}_'’-]+)/gu;

function mentionFindings(text: string): Located[] {
  const people = new Set([...text.matchAll(MENTION)].map(([, name = ""]) => name.toLowerCase()).filter((name) => name !== "tembo"));
  return people.size >= MENTION_FLOOD ? [{ kind: "mentions", reason: FINDING_REASONS.mentions, key: null, span: null }] : [];
}
