/**
 * Split a sentence around a phrase so it can be coloured. If the shared copy
 * changes and the phrase disappears, the sentence renders plain.
 */
export function accent(text: string, phrase: string): Array<{ text: string; accent: boolean }> {
  const index = text.indexOf(phrase);
  if (index < 0) return [{ text, accent: false }];
  return [
    { text: text.slice(0, index), accent: false },
    { text: phrase, accent: true },
    { text: text.slice(index + phrase.length), accent: false },
  ].filter((part) => part.text.length > 0);
}

/**
 * The sentence as words, each a list of segments so an accented phrase can end
 * mid-word ("software" accented, "." not) without adding a space.
 */
export function words(text: string, phrase?: string): Array<Array<{ text: string; accent: boolean }>> {
  const start = phrase ? text.indexOf(phrase) : -1;
  const end = start < 0 || !phrase ? -1 : start + phrase.length;
  const result: Array<Array<{ text: string; accent: boolean }>> = [];
  for (const match of text.matchAll(/\S+/g)) {
    const from = match.index ?? 0;
    const segments: Array<{ text: string; accent: boolean }> = [];
    for (let i = 0; i < match[0].length; i += 1) {
      const accented = from + i >= start && from + i < end;
      const last = segments.at(-1);
      if (last && last.accent === accented) last.text += match[0][i];
      else segments.push({ text: match[0][i], accent: accented });
    }
    result.push(segments);
  }
  return result;
}
