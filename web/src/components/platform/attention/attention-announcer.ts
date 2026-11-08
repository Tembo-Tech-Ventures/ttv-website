import { createAnnouncer } from "@/lib/platform/client/announcer";

export type Announcer = ReturnType<typeof createAnnouncer>;

/**
 * The attention announcer's pace: one voice, at most every 750 ms, never the same words within 4 s.
 * Zod-free, so the overlays island can create it, and its live region, before the store loads.
 */
export const createAttentionAnnouncer = (): Announcer => createAnnouncer({ throttleMs: 750, dedupeMs: 4_000 });
