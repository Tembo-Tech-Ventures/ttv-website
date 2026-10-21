import {
  FeedbackValidationError,
  MAX_FEEDBACK_ADMIN_NOTE_LENGTH,
  MAX_FEEDBACK_RESPONSE_LENGTH,
  normalizeOptionalText,
  normalizeResolutionUrl,
  parseFeedbackKind,
} from "./model";
import type { FeedbackThemePatch, FeedbackThemeRecord, NewFeedbackTheme } from "./theme-store";
import {
  assessTheme,
  normalizeThemeSummary,
  normalizeThemeTitle,
  parseThemeChange,
  parseThemeStatus,
} from "./themes";

export function themeAdminPath(id: string): string {
  return `/admin/feedback/themes/${encodeURIComponent(id)}`;
}

/** What agents read through `/api/admin/feedback/themes`. */
export function toThemeJson(theme: FeedbackThemeRecord, origin: string, now = new Date()) {
  return {
    id: theme.id,
    title: theme.title,
    summary: theme.summary,
    kind: theme.kind,
    status: theme.status,
    change: theme.change,
    issueUrl: theme.issueUrl,
    prUrl: theme.prUrl,
    decisionNote: theme.decisionNote,
    stats: {
      ...theme.stats,
      lastReportAt: theme.stats.lastReportAt?.toISOString() ?? null,
    },
    assessment: assessTheme(
      {
        kind: theme.kind,
        status: theme.status,
        change: theme.change,
        recentStudents: theme.stats.recentStudents,
        lastReportAt: theme.stats.lastReportAt,
      },
      now
    ),
    createdAt: theme.createdAt.toISOString(),
    updatedAt: theme.updatedAt.toISOString(),
    closedAt: theme.closedAt?.toISOString() ?? null,
    adminUrl: new URL(themeAdminPath(theme.id), origin).toString(),
  };
}

function asObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new FeedbackValidationError("Send a JSON object.");
  }
  return body as Record<string, unknown>;
}

function rejectUnknown(input: Record<string, unknown>, allowed: ReadonlySet<string>) {
  const unknown = Object.keys(input).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new FeedbackValidationError(
      `Unknown field${unknown.length === 1 ? "" : "s"}: ${unknown.join(", ")}.`
    );
  }
}

function parseChange(value: unknown) {
  if (value === null) return null;
  const change = parseThemeChange(value);
  if (!change) throw new FeedbackValidationError("change must be FIX, SIMPLIFY, ADD or null.");
  return change;
}

const CREATE_KEYS = new Set(["title", "summary", "kind", "change"]);

export function parseThemeCreate(body: unknown): NewFeedbackTheme {
  const input = asObject(body);
  rejectUnknown(input, CREATE_KEYS);
  return {
    title: normalizeThemeTitle(input.title),
    summary: normalizeThemeSummary(input.summary),
    kind: parseFeedbackKind(input.kind),
    change: input.change === undefined ? null : parseChange(input.change),
  };
}

const UPDATE_KEYS = new Set([
  "title",
  "summary",
  "kind",
  "status",
  "change",
  "issueUrl",
  "prUrl",
  "decisionNote",
  "studentMessage",
]);

export interface ParsedThemeUpdate {
  patch: FeedbackThemePatch;
  studentMessage: string | null;
}

/**
 * Validates a theme PATCH. Shipping or declining requires `studentMessage`:
 * it becomes the reply on every open note, so nobody is closed in silence.
 */
export function parseThemeUpdate(body: unknown): ParsedThemeUpdate {
  const input = asObject(body);
  rejectUnknown(input, UPDATE_KEYS);
  const patch: FeedbackThemePatch = {};
  if ("title" in input) patch.title = normalizeThemeTitle(input.title);
  if ("summary" in input) patch.summary = normalizeThemeSummary(input.summary);
  if ("kind" in input) patch.kind = parseFeedbackKind(input.kind);
  if ("status" in input) {
    const status = parseThemeStatus(input.status);
    if (!status) throw new FeedbackValidationError("Unknown theme status.");
    patch.status = status;
  }
  if ("change" in input) patch.change = parseChange(input.change);
  if ("issueUrl" in input) patch.issueUrl = normalizeResolutionUrl(input.issueUrl);
  if ("prUrl" in input) patch.prUrl = normalizeResolutionUrl(input.prUrl);
  if ("decisionNote" in input) {
    patch.decisionNote = normalizeOptionalText(
      input.decisionNote,
      MAX_FEEDBACK_ADMIN_NOTE_LENGTH,
      "The decision note"
    );
  }
  const studentMessage = normalizeOptionalText(
    input.studentMessage,
    MAX_FEEDBACK_RESPONSE_LENGTH,
    "The message to students"
  );
  if ((patch.status === "SHIPPED" || patch.status === "DECLINED") && !studentMessage) {
    throw new FeedbackValidationError(
      "Shipping or declining a theme needs a studentMessage: it is the reply every student on it sees."
    );
  }
  if (Object.keys(patch).length === 0) {
    throw new FeedbackValidationError("Nothing to update.");
  }
  return { patch, studentMessage };
}

/** The console's theme form posts the same fields as the API. */
export function themeUpdateFromForm(formData: FormData): ParsedThemeUpdate {
  const fields: Record<string, unknown> = {};
  for (const key of UPDATE_KEYS) {
    const entry = formData.get(key);
    if (typeof entry !== "string") continue;
    fields[key] = key === "change" ? entry || null : entry;
  }
  return parseThemeUpdate(fields);
}
