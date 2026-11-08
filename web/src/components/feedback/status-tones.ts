import type { ChipTone } from "@/components/platform/ui";
import type { FeedbackStatus } from "@/lib/feedback/model";
import type { FeedbackThemeStatus } from "@/lib/feedback/themes";

/*
 * Each feedback status's Chip tone in the admin pages, said once so a note or a theme looks the same on
 * its list and on its own page. Peach is what waits on someone (a new note, a proposal for the owner's
 * yes), success is shipped or resolved, and the rest are facts, in words.
 * TODO(K2): StatusChip and statusTone("feedback" | "theme") replace these once lane K's detail parts merge.
 */
export const NOTE_STATUS_TONES: Record<FeedbackStatus, ChipTone> = {
  NEW: "peach",
  IN_PROGRESS: "neutral",
  RESOLVED: "success",
  DECLINED: "neutral",
};

export const THEME_STATUS_TONES: Record<FeedbackThemeStatus, ChipTone> = {
  COLLECTING: "neutral",
  PROPOSED: "peach",
  PLANNED: "neutral",
  IN_PROGRESS: "neutral",
  SHIPPED: "success",
  DECLINED: "neutral",
  DORMANT: "neutral",
};
