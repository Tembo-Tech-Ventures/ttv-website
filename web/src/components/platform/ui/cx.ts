/** Joins class names, dropping the falsy ones a conditional leaves behind. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
