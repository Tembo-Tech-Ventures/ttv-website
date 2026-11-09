/**
 * What a mentor's confirmation must say, and how its evidence links are shown, for the Confirm work page
 * (confirm-state.ts, ConfirmWork.astro).
 */
export function validateMentorNote(note: string): string | null {
  const text = note.trim();
  if (text.length < 20 || text.split(/\s+/u).length < 3) {
    return "Describe what you personally checked in at least 20 characters and three words.";
  }
  if (text.length > 2000)
    return "Keep your review note within 2,000 characters.";
  return null;
}

export function validateMentorMethod(method: string): string | null {
  const length = method.trim().length;
  return length < 3 || length > 500
    ? "Describe how you checked the claim in 3 to 500 characters."
    : null;
}

/**
 * Where an evidence link goes, short enough to read: "github.com/achieng/ledger".
 * Members often leave the default title ("Supporting work"), so the address is
 * what tells one link from the next. The host is always shown whole, so a long
 * look-alike ("github.com.evil.example") can never pass for the real site; only
 * the path is shortened.
 */
export function evidenceDestination(href: string, max = 48): string {
  const url = new URL(href);
  const host = url.hostname.replace(/^www\./, "");
  const path = url.pathname.replace(/\/$/, "");
  const room = Math.max(0, max - host.length);
  return path.length <= room ? host + path : `${host}${path.slice(0, Math.max(0, room - 1))}…`;
}

export function safeMentorEvidenceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
