import {
  FeedbackValidationError,
  MAX_FEEDBACK_ADMIN_NOTE_LENGTH,
  MAX_FEEDBACK_RESPONSE_LENGTH,
  normalizeOptionalText,
  normalizeResolutionUrl,
  parseFeedbackStatus,
  type FeedbackStatus,
} from "./model";
import type { FeedbackPatch, FeedbackRecord } from "./store";

export function feedbackAttachmentPath(attachmentId: string): string {
  return `/api/feedback/attachments/${encodeURIComponent(attachmentId)}`;
}

/**
 * The shape agents read through `/api/admin/feedback`. URLs are absolute so a
 * script can fetch screenshots with the same bearer token without knowing the
 * site's routing.
 */
export function toFeedbackJson(record: FeedbackRecord, origin: string) {
  return {
    id: record.id,
    kind: record.kind,
    status: record.status,
    message: record.message,
    page: { url: record.pageUrl, title: record.pageTitle },
    context: record.context,
    appVersion: record.appVersion,
    submittedBy: { id: record.user.id, name: record.user.name },
    response: record.response,
    adminNote: record.adminNote,
    resolutionUrl: record.resolutionUrl,
    handledBy: record.handledBy,
    sensitive: record.sensitive,
    theme: record.theme,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
    resolvedAt: record.resolvedAt?.toISOString() ?? null,
    adminUrl: new URL(`/admin/feedback/${encodeURIComponent(record.id)}`, origin).toString(),
    attachments: record.attachments.map((attachment) => ({
      id: attachment.id,
      url: new URL(feedbackAttachmentPath(attachment.id), origin).toString(),
      contentType: attachment.contentType,
      size: attachment.size,
      source: attachment.source,
    })),
  };
}

export type FeedbackJson = ReturnType<typeof toFeedbackJson>;

export interface ParsedFeedbackUpdate {
  patch: FeedbackPatch;
  expectedStatus?: FeedbackStatus;
}

const UPDATE_KEYS = new Set([
  "status",
  "themeId",
  "sensitive",
  "expectedStatus",
  "response",
  "adminNote",
  "resolutionUrl",
]);

/** Validates a PATCH body. Absent keys are left alone; `null` clears a field. */
export function parseFeedbackUpdate(body: unknown): ParsedFeedbackUpdate {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new FeedbackValidationError("Send a JSON object.");
  }
  const input = body as Record<string, unknown>;
  const unknownKeys = Object.keys(input).filter((key) => !UPDATE_KEYS.has(key));
  if (unknownKeys.length > 0) {
    throw new FeedbackValidationError(
      `Unknown field${unknownKeys.length === 1 ? "" : "s"}: ${unknownKeys.join(", ")}.`
    );
  }

  const patch: FeedbackPatch = {};
  if ("status" in input) {
    const status = parseFeedbackStatus(input.status);
    if (!status) throw new FeedbackValidationError("Unknown status.");
    patch.status = status;
  }
  if ("themeId" in input) {
    if (input.themeId !== null && (typeof input.themeId !== "string" || !input.themeId)) {
      throw new FeedbackValidationError("themeId must be a theme id or null.");
    }
    patch.themeId = input.themeId;
  }
  if ("sensitive" in input) {
    if (typeof input.sensitive !== "boolean") {
      throw new FeedbackValidationError("sensitive must be true or false.");
    }
    patch.sensitive = input.sensitive;
  }
  if ("response" in input) {
    patch.response = normalizeOptionalText(
      input.response,
      MAX_FEEDBACK_RESPONSE_LENGTH,
      "The reply"
    );
  }
  if ("adminNote" in input) {
    patch.adminNote = normalizeOptionalText(
      input.adminNote,
      MAX_FEEDBACK_ADMIN_NOTE_LENGTH,
      "The internal note"
    );
  }
  if ("resolutionUrl" in input) {
    patch.resolutionUrl = normalizeResolutionUrl(input.resolutionUrl);
  }
  if (Object.keys(patch).length === 0) {
    throw new FeedbackValidationError("Nothing to update.");
  }

  let expectedStatus: FeedbackStatus | undefined;
  if (input.expectedStatus !== undefined) {
    const parsed = parseFeedbackStatus(input.expectedStatus);
    if (!parsed) throw new FeedbackValidationError("Unknown expectedStatus.");
    expectedStatus = parsed;
  }
  return { patch, expectedStatus };
}

/** The admin console form posts the same fields as the API. */
export function feedbackUpdateFromForm(formData: FormData): ParsedFeedbackUpdate {
  const fields: Record<string, unknown> = {};
  for (const key of ["status", "response", "adminNote", "resolutionUrl"]) {
    const entry = formData.get(key);
    if (typeof entry === "string") fields[key] = entry;
  }
  // The console form always carries both controls; an unchecked box is false.
  const themeId = formData.get("themeId");
  if (typeof themeId === "string") fields.themeId = themeId || null;
  if (formData.has("themeId")) fields.sensitive = formData.has("sensitive");
  return parseFeedbackUpdate(fields);
}
