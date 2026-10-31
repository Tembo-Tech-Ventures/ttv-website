/**
 * Avatar backgrounds, all from the brand: peach and ring, each at three
 * strengths. Initials are dark teal on every one of them (4.5:1 or better,
 * checked in contrast.test.ts).
 */
export const AVATAR_PALETTE = [
  "#F28D68",
  "#F7B08F",
  "#FFD0BD",
  "#9FD3CA",
  "#C8E6E0",
  "#FFE7DB",
] as const;

/**
 * A person's avatar colour, derived from their id alone. Never from their
 * position in a list: the same person must look the same in every list,
 * thread and reply stack they appear in, before and after anyone else joins.
 *
 * FNV-1a over the id's UTF-16 code units: tiny, deterministic everywhere, and
 * spreads near-identical ids ("user-1", "user-2") across the palette.
 */
export function avatarColour(id: string): (typeof AVATAR_PALETTE)[number] {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return AVATAR_PALETTE[(hash >>> 0) % AVATAR_PALETTE.length];
}

/** "Wanjiku Mwangi" → "WM"; "Tembo" → "T"; "" → "?". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  const first = Array.from(words[0])[0];
  const last = words.length > 1 ? Array.from(words[words.length - 1])[0] : "";
  return `${first}${last}`.toLocaleUpperCase();
}
