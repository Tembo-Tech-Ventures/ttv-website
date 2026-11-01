import type { AuthorSummary } from "@/lib/platform/contracts";

export type MentionCandidate =
  | { kind: "tembo"; key: "tembo"; insert: "@tembo"; label: "@tembo"; description: string }
  | { kind: "person"; key: string; insert: string; label: string; description: string; person: AuthorSummary };

/** The text being typed after an `@` at the caret, or null when not in a mention. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const before = text.slice(0, caret);
  const match = /(^|[\s([{])@([\p{L}\p{N}_'’-]*(?: [\p{L}\p{N}_'’-]+)?)$/u.exec(before);
  if (!match) return null;
  const start = before.length - match[2].length - 1;
  return { start, query: match[2] };
}

/** "Mentor · in this thread", from the badges the server sends. */
function describe(person: AuthorSummary, where: string): string {
  const badge = person.roleBadges[0]?.label;
  return badge ? `${badge} · ${where}` : where;
}

/**
 * Who `@` can reach here: Tembo first when it is switched on, then people in
 * this conversation whose name (or any word of it) starts with what was typed.
 * S-2.2 replaces the people with the channel's members.
 */
export function mentionCandidates(
  query: string,
  { people, tembo, temboDescription, where, limit = 6 }: {
    people: readonly AuthorSummary[]; tembo: boolean; temboDescription: string;
    /** Where this person is, said after their badge: "in this thread". */
    where: (person: AuthorSummary) => string;
    limit?: number;
  },
): MentionCandidate[] {
  const q = query.trim().toLocaleLowerCase();
  const matches = (name: string) => {
    const lower = name.toLocaleLowerCase();
    return q === "" || lower.startsWith(q) || lower.split(/\s+/).some((word) => word.startsWith(q));
  };
  const result: MentionCandidate[] = [];
  if (tembo && matches("tembo")) {
    result.push({ kind: "tembo", key: "tembo", insert: "@tembo", label: "@tembo", description: temboDescription });
  }
  const seen = new Set<string>();
  for (const person of people) {
    if (person.id === null || seen.has(person.id) || !matches(person.name)) continue;
    seen.add(person.id);
    result.push({
      kind: "person", key: person.id, insert: `@${person.name}`, label: `@${person.name}`,
      description: describe(person, where(person)), person,
    });
  }
  return result.slice(0, limit);
}

/** Replace the mention being typed with the chosen one, and say where the caret goes. */
export function insertMention(text: string, start: number, caret: number, insert: string): { text: string; caret: number } {
  const after = text.slice(caret);
  const spaced = `${insert}${after.startsWith(" ") ? "" : " "}`;
  // After the space either way, ready for the next word.
  return { text: `${text.slice(0, start)}${spaced}${after}`, caret: start + insert.length + 1 };
}
