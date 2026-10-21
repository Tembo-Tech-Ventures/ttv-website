import {
  FEEDBACK_THEME_CHANGES,
  FEEDBACK_THEME_STATUSES,
} from "@/lib/db/schema";
import {
  FeedbackValidationError,
  type FeedbackKind,
  type FeedbackStatus,
} from "./model";

export type FeedbackThemeStatus = (typeof FEEDBACK_THEME_STATUSES)[number];
export type FeedbackThemeChange = (typeof FEEDBACK_THEME_CHANGES)[number];

export { FEEDBACK_THEME_CHANGES, FEEDBACK_THEME_STATUSES };

/*
 * The owner's triage decisions (project policy, 2026-10-21). Changing one of
 * these is a product decision, not a tuning knob.
 */
/** Ideas and "confusing" themes need this many distinct students… */
export const THEME_AGREEMENT_STUDENTS = 3;
/** …within this many days. */
export const THEME_AGREEMENT_WINDOW_DAYS = 60;
/** A collecting theme with no new note for this long goes dormant. */
export const THEME_DORMANT_AFTER_DAYS = 90;
/** Simplifications proceed if the owner has not answered within this. */
export const THEME_SIMPLIFY_DEFAULT_DAYS = 7;

const MAX_THEME_TITLE_LENGTH = 120;
const MAX_THEME_SUMMARY_LENGTH = 4_000;

export const OPEN_FEEDBACK_THEME_STATUSES: readonly FeedbackThemeStatus[] = [
  "COLLECTING",
  "PROPOSED",
  "PLANNED",
  "IN_PROGRESS",
];

export const FEEDBACK_THEME_STATUS_LABELS: Record<FeedbackThemeStatus, string> = {
  COLLECTING: "Collecting",
  PROPOSED: "Proposed",
  PLANNED: "Planned",
  IN_PROGRESS: "In progress",
  SHIPPED: "Shipped",
  DECLINED: "Declined",
  DORMANT: "Dormant",
};

/**
 * What a student sees for one of their notes. A note on a theme follows the
 * theme, so one agent update moves every student who raised it.
 */
export type StudentFeedbackState =
  | "RECEIVED"
  | "PLANNED"
  | "IN_PROGRESS"
  | "DONE"
  | "NOT_PLANNED";

export const STUDENT_FEEDBACK_STATE_LABELS: Record<StudentFeedbackState, string> = {
  RECEIVED: "Received",
  PLANNED: "Planned",
  IN_PROGRESS: "Being worked on",
  DONE: "Done",
  NOT_PLANNED: "Not planned",
};

const STATE_FROM_NOTE: Record<FeedbackStatus, StudentFeedbackState> = {
  NEW: "RECEIVED",
  IN_PROGRESS: "IN_PROGRESS",
  RESOLVED: "DONE",
  DECLINED: "NOT_PLANNED",
};

const STATE_FROM_THEME: Record<FeedbackThemeStatus, StudentFeedbackState> = {
  COLLECTING: "RECEIVED",
  PROPOSED: "RECEIVED",
  DORMANT: "RECEIVED",
  PLANNED: "PLANNED",
  IN_PROGRESS: "IN_PROGRESS",
  SHIPPED: "DONE",
  DECLINED: "NOT_PLANNED",
};

export function studentFeedbackState(
  noteStatus: FeedbackStatus,
  themeStatus: FeedbackThemeStatus | null
): StudentFeedbackState {
  // A note someone closed by hand keeps that answer even if its theme moves.
  if (noteStatus === "RESOLVED" || noteStatus === "DECLINED") {
    return STATE_FROM_NOTE[noteStatus];
  }
  return themeStatus ? STATE_FROM_THEME[themeStatus] : STATE_FROM_NOTE[noteStatus];
}

export function isClosedThemeStatus(status: FeedbackThemeStatus): boolean {
  return status === "SHIPPED" || status === "DECLINED";
}

function includes<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

export function parseThemeStatus(value: unknown): FeedbackThemeStatus | null {
  return includes(FEEDBACK_THEME_STATUSES, value) ? value : null;
}

export function parseThemeChange(value: unknown): FeedbackThemeChange | null {
  return includes(FEEDBACK_THEME_CHANGES, value) ? value : null;
}

export function parseThemeStatusFilter(value: string | null): FeedbackThemeStatus[] {
  if (!value || value === "open") return [...OPEN_FEEDBACK_THEME_STATUSES];
  if (value === "all") return [...FEEDBACK_THEME_STATUSES];
  const statuses = value
    .split(",")
    .map((part) => part.trim().toUpperCase())
    .filter((part): part is FeedbackThemeStatus => includes(FEEDBACK_THEME_STATUSES, part));
  if (statuses.length === 0) {
    throw new FeedbackValidationError(
      `Unknown theme status filter. Use open, all, or any of ${FEEDBACK_THEME_STATUSES.join(", ")}.`
    );
  }
  return [...new Set(statuses)];
}

/** Titles and summaries are public-facing; keep them plain and bounded. */
export function normalizeThemeTitle(value: unknown): string {
  const title = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (!title || title.length > MAX_THEME_TITLE_LENGTH) {
    throw new FeedbackValidationError(
      `A theme title must be between 1 and ${MAX_THEME_TITLE_LENGTH} characters.`
    );
  }
  return title;
}

export function normalizeThemeSummary(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (typeof value !== "string") {
    throw new FeedbackValidationError("The summary must be text.");
  }
  const summary = value.replace(/\r\n/g, "\n").trim();
  if (summary.length > MAX_THEME_SUMMARY_LENGTH) {
    throw new FeedbackValidationError(
      `The summary must be ${MAX_THEME_SUMMARY_LENGTH.toLocaleString("en")} characters or fewer.`
    );
  }
  return summary;
}

export interface ThemeSignals {
  kind: FeedbackKind;
  status: FeedbackThemeStatus;
  change: FeedbackThemeChange | null;
  /** Distinct students with a note on the theme inside the agreement window. */
  recentStudents: number;
  lastReportAt: Date | null;
}

export interface ThemeAssessment {
  /** Enough agreement (or a bug) to put in front of the owner. */
  readyToPropose: boolean;
  /** No new note for THEME_DORMANT_AFTER_DAYS while still collecting. */
  goingDormant: boolean;
  /**
   * "owner": wait for an explicit yes. "default": proceeds after
   * THEME_SIMPLIFY_DEFAULT_DAYS of silence. "none": a fix goes straight ahead.
   */
  approval: "owner" | "default" | "none";
  reason: string;
}

const DAY_MS = 24 * 60 * 60 * 1_000;

/**
 * Applies the owner's triage rules to one theme. Every student counts once and
 * nobody counts more because of who they are; praise never becomes work.
 */
export function assessTheme(theme: ThemeSignals, now = new Date()): ThemeAssessment {
  const approval: ThemeAssessment["approval"] =
    theme.change === "FIX" ? "none" : theme.change === "SIMPLIFY" ? "default" : "owner";
  const collecting = theme.status === "COLLECTING" || theme.status === "DORMANT";
  const quietFor = theme.lastReportAt
    ? (now.getTime() - theme.lastReportAt.getTime()) / DAY_MS
    : Infinity;
  const goingDormant = theme.status === "COLLECTING" && quietFor >= THEME_DORMANT_AFTER_DAYS;

  if (theme.kind === "PRAISE") {
    return {
      readyToPropose: false,
      goingDormant,
      approval,
      reason: "Praise is kept as a signal to protect what works, not turned into work.",
    };
  }
  if (!collecting) {
    return {
      readyToPropose: false,
      goingDormant: false,
      approval,
      reason: `Already ${FEEDBACK_THEME_STATUS_LABELS[theme.status].toLowerCase()}.`,
    };
  }
  if (theme.kind === "BUG" && theme.recentStudents >= 1) {
    return {
      readyToPropose: true,
      goingDormant: false,
      approval: "none",
      reason: "A reproducible bug needs only one report.",
    };
  }
  const needed = THEME_AGREEMENT_STUDENTS - theme.recentStudents;
  if (needed <= 0) {
    return {
      readyToPropose: true,
      goingDormant: false,
      approval,
      reason: `${theme.recentStudents} students raised this in the last ${THEME_AGREEMENT_WINDOW_DAYS} days.`,
    };
  }
  return {
    readyToPropose: false,
    goingDormant,
    approval,
    reason: `Needs ${needed} more student${needed === 1 ? "" : "s"} within ${THEME_AGREEMENT_WINDOW_DAYS} days.`,
  };
}
