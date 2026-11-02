import type { Citation, TemboScope } from "@/lib/platform/contracts";
import { TEMBO_CONFIG } from "./config";
import { SCOPE_WORDS, type SourceBook } from "./sources";

/**
 * Grounding (README.md beside this file, "Grounding"). The model tags each sentence with the sources
 * it relies on ([S2], or [S2, S5]). Here, on the server:
 *
 * - a tag is kept only when it names a source this answer was given (SourceBook), so a made-up or
 *   mistyped tag cites nothing;
 * - a sentence left without a valid tag states something no source supports, and is dropped;
 * - when nothing is left, or the model said NO_ANSWER, Tembo says it doesn't know instead;
 * - kept tags become [1], [2], … in order of first use, matching the stored citations.
 */

/** What the model answers when the sources don't support an answer. */
export const NO_ANSWER = "NO_ANSWER";

export interface Grounded {
  body: string;
  citations: Citation[];
  /** false when Tembo says it doesn't know. */
  grounded: boolean;
  /** Sentences dropped for having no valid tag. */
  dropped: number;
}

const TAGS = /\[\s*S\d{1,3}(?:\s*[,;]\s*S\d{1,3})*\s*\]/giu;
const TAG_KEY = /S\d{1,3}/giu;
/** A sentence ends at . ! ? or … and space; tags right after the stop still belong to it. */
const SENTENCE_END = /(?<=[.!?…])\s+(?!\[\s*S\d)|(?<=[.!?…]\s*(?:\[\s*S\d[^\]]*\]\s*)+)\s+(?=[^\s[])/u;
const TRAILING_STOP = /[.!?…]+["”’)]*$/u;
/** A list marker or quote at the start of a line, kept as it was. */
const LINE_LEAD = /^\s*(?:[-*•]\s+|\d{1,2}[.)]\s+|>\s*)?/u;

export function refusal(scope: TemboScope): string {
  const elsewhere = scope === "DIRECT" ? "" : " Someone here may know.";
  return `I don't know. I couldn't find this in ${SCOPE_WORDS[scope]}.${elsewhere}`;
}

interface Sentence { text: string; keys: string[] }

function sentencesOf(line: string, book: SourceBook): { kept: Sentence[]; dropped: number } {
  const kept: Sentence[] = [];
  let dropped = 0;
  for (const raw of line.split(SENTENCE_END)) {
    const keys = [...raw.matchAll(TAGS)].flatMap(([tag]) => [...tag.matchAll(TAG_KEY)].map(([key]) => key.toUpperCase()))
      .filter((key) => book.get(key) !== undefined);
    // Numbered markers are the server's to write; any the model wrote are dropped with its tags.
    const text = raw.replace(TAGS, "").replace(/\[\d{1,3}\]/gu, "").replace(/\s+([.,;:!?…])/gu, "$1").replace(/\s{2,}/gu, " ").trim();
    if (!/[\p{L}\p{N}]/u.test(text)) continue;
    if (keys.length === 0) dropped += 1;
    else kept.push({ text, keys: [...new Set(keys)] });
  }
  return { kept, dropped };
}

/** Grounds a raw model answer against the sources it was given. */
export function groundAnswer(raw: string, book: SourceBook, scope: TemboScope): Grounded {
  const text = raw.replace(/<think>[\s\S]*?<\/think>/giu, "").replace(/\r\n?/gu, "\n").trim();
  const unknown = { body: refusal(scope), citations: [], grounded: false };
  if (text === "" || new RegExp(`\\b${NO_ANSWER}\\b`, "u").test(text)) return { ...unknown, dropped: 0 };

  let dropped = 0;
  let length = 0;
  const lines: { lead: string; sentences: Sentence[] }[] = [];
  for (const line of text.split("\n")) {
    const lead = LINE_LEAD.exec(line)?.[0] ?? "";
    const { kept, dropped: lost } = sentencesOf(line.slice(lead.length), book);
    dropped += lost;
    const fitting: Sentence[] = [];
    for (const sentence of kept) {
      // Room for the sentence, its markers and a separator; the rest of the answer is cut.
      const cost = sentence.text.length + sentence.keys.length * 5 + lead.length + 1;
      if (length + cost > TEMBO_CONFIG.answerChars) { dropped += 1; continue; }
      length += cost;
      fitting.push(sentence);
    }
    if (fitting.length > 0) lines.push({ lead: lead.trimStart(), sentences: fitting });
  }
  if (lines.length === 0) return { ...unknown, dropped };

  const numbers = new Map<string, number>();
  const citations: Citation[] = [];
  const body = lines.map(({ lead, sentences }) => lead + sentences.map(({ text: sentence, keys }) => {
    const markers = keys.map((key) => {
      let n = numbers.get(key);
      if (n === undefined) {
        const source = book.get(key);
        if (!source) return "";
        citations.push(source.citation);
        n = citations.length;
        numbers.set(key, n);
      }
      return `[${n}]`;
    }).join("");
    const stop = TRAILING_STOP.exec(sentence)?.[0] ?? "";
    return `${sentence.slice(0, sentence.length - stop.length).trimEnd()} ${markers}${stop}`;
  }).join(" ")).join("\n");
  return { body, citations, grounded: true, dropped };
}
