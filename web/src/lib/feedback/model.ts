import { z } from "zod";
import {
  FEEDBACK_ATTACHMENT_SOURCES,
  FEEDBACK_ATTACHMENT_TYPES,
  FEEDBACK_KINDS,
  FEEDBACK_STATUSES,
} from "@/lib/db/schema";

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];
export type FeedbackStatus = (typeof FEEDBACK_STATUSES)[number];
export type FeedbackAttachmentType = (typeof FEEDBACK_ATTACHMENT_TYPES)[number];
export type FeedbackAttachmentSource =
  (typeof FEEDBACK_ATTACHMENT_SOURCES)[number];

export { FEEDBACK_KINDS, FEEDBACK_STATUSES };

export const MAX_FEEDBACK_MESSAGE_LENGTH = 5_000;
export const MAX_FEEDBACK_ATTACHMENTS = 5;
export const MAX_FEEDBACK_ATTACHMENT_BYTES = 5 * 1024 * 1024;
export const MAX_FEEDBACK_PER_DAY = 30;
export const MAX_FEEDBACK_RESPONSE_LENGTH = 2_000;
export const MAX_FEEDBACK_ADMIN_NOTE_LENGTH = 5_000;
export const MAX_FEEDBACK_CONTEXT_ERRORS = 10;
const MAX_PAGE_URL_LENGTH = 2_000;
const MAX_PAGE_TITLE_LENGTH = 200;
const MAX_RESOLUTION_URL_LENGTH = 500;

/** The words a student picks from. Order is the order the widget shows. */
export const FEEDBACK_KIND_LABELS: Record<FeedbackKind, string> = {
  BUG: "Something's broken",
  CONFUSING: "Confusing",
  IDEA: "Idea",
  PRAISE: "I like this",
  OTHER: "Other",
};

export const FEEDBACK_ADMIN_STATUS_LABELS: Record<FeedbackStatus, string> = {
  NEW: "New",
  IN_PROGRESS: "In progress",
  RESOLVED: "Resolved",
  DECLINED: "Declined",
};

export const OPEN_FEEDBACK_STATUSES: readonly FeedbackStatus[] = [
  "NEW",
  "IN_PROGRESS",
];

export class FeedbackValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedbackValidationError";
  }
}

function includes<T extends string>(list: readonly T[], value: unknown): value is T {
  return typeof value === "string" && (list as readonly string[]).includes(value);
}

export function parseFeedbackKind(value: unknown): FeedbackKind {
  if (value === null || value === undefined || value === "") return "OTHER";
  if (includes(FEEDBACK_KINDS, value)) return value;
  throw new FeedbackValidationError("Choose what kind of feedback this is.");
}

export function parseFeedbackStatus(value: unknown): FeedbackStatus | null {
  return includes(FEEDBACK_STATUSES, value) ? value : null;
}

/** Parses `?status=NEW,IN_PROGRESS`; `open` and `all` are shorthands. */
export function parseFeedbackStatusFilter(
  value: string | null
): FeedbackStatus[] {
  if (!value || value === "open") return [...OPEN_FEEDBACK_STATUSES];
  if (value === "all") return [...FEEDBACK_STATUSES];
  const statuses = value
    .split(",")
    .map((part) => part.trim().toUpperCase())
    .filter((part): part is FeedbackStatus => includes(FEEDBACK_STATUSES, part));
  if (statuses.length === 0) {
    throw new FeedbackValidationError(
      `Unknown status filter. Use open, all, or any of ${FEEDBACK_STATUSES.join(", ")}.`
    );
  }
  return [...new Set(statuses)];
}

export function normalizeFeedbackMessage(value: unknown): string {
  const message = typeof value === "string" ? value.replace(/\r\n/g, "\n").trim() : "";
  if (message.length > MAX_FEEDBACK_MESSAGE_LENGTH) {
    throw new FeedbackValidationError(
      `Keep feedback under ${MAX_FEEDBACK_MESSAGE_LENGTH.toLocaleString("en")} characters.`
    );
  }
  return message;
}

/**
 * The page the student was on. Only same-origin pages are accepted, so the
 * field cannot be used to plant an arbitrary link in the admin console.
 */
export function normalizeFeedbackPageUrl(value: unknown, requestUrl: string): string {
  const fallback = "/";
  const raw = typeof value === "string" && value.trim() ? value.trim() : fallback;
  let parsed: URL;
  try {
    parsed = new URL(raw, requestUrl);
  } catch {
    throw new FeedbackValidationError("The page address could not be read.");
  }
  if (parsed.origin !== new URL(requestUrl).origin) {
    throw new FeedbackValidationError("Feedback must come from a page on this site.");
  }
  parsed.hash = "";
  const normalized = parsed.toString();
  if (normalized.length > MAX_PAGE_URL_LENGTH) {
    return `${parsed.origin}${parsed.pathname}`.slice(0, MAX_PAGE_URL_LENGTH);
  }
  return normalized;
}

/** The path a stored page URL points at, for compact display. */
export function feedbackPagePath(pageUrl: string): string {
  try {
    const parsed = new URL(pageUrl);
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return pageUrl;
  }
}

export function normalizeFeedbackPageTitle(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const title = value.replace(/\s+/g, " ").trim().slice(0, MAX_PAGE_TITLE_LENGTH);
  return title || null;
}

const boundedString = (max: number) =>
  z
    .string()
    .transform((value) => value.slice(0, max))
    .optional()
    .catch(undefined);

const dimension = z
  .object({
    width: z.number().int().min(0).max(100_000),
    height: z.number().int().min(0).max(100_000),
  })
  .optional()
  .catch(undefined);

const clientErrorSchema = z.object({
  message: z.string().transform((value) => value.slice(0, 500)),
  source: boundedString(300),
  at: boundedString(40),
});

const feedbackContextSchema = z.object({
  viewport: dimension,
  screen: dimension,
  devicePixelRatio: z.number().min(0).max(10).optional().catch(undefined),
  userAgent: boundedString(400),
  language: boundedString(35),
  timezone: boundedString(64),
  colorScheme: z.enum(["light", "dark"]).optional().catch(undefined),
  online: z.boolean().optional().catch(undefined),
  touch: z.boolean().optional().catch(undefined),
  errors: z
    .array(z.unknown())
    .optional()
    .catch(undefined)
    .transform((errors) =>
      (errors ?? [])
        .slice(-MAX_FEEDBACK_CONTEXT_ERRORS)
        .map((error) => clientErrorSchema.safeParse(error))
        .flatMap((result) => (result.success ? [result.data] : []))
    ),
});

export type FeedbackContext = z.infer<typeof feedbackContextSchema>;

/**
 * Keeps only the browser facts the widget is documented to send, each with a
 * bound. Unknown keys and malformed values are dropped rather than rejected:
 * a student should never lose their feedback because a browser reported an
 * odd screen size.
 */
export function sanitizeFeedbackContext(value: unknown): FeedbackContext {
  let parsed: unknown = value;
  if (typeof value === "string") {
    try {
      parsed = JSON.parse(value);
    } catch {
      parsed = {};
    }
  }
  const result = feedbackContextSchema.safeParse(
    parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {}
  );
  return result.success ? result.data : { errors: [] };
}

/**
 * Reads the image type from the file's own bytes. The browser-supplied MIME
 * type is never trusted: attachments are served back to admins, and an HTML
 * file labelled image/png must not become one.
 */
export function sniffFeedbackImageType(
  bytes: Uint8Array
): FeedbackAttachmentType | null {
  const startsWith = (signature: number[], offset = 0) =>
    signature.every((byte, index) => bytes[offset + index] === byte);
  if (startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (startsWith([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith([0x47, 0x49, 0x46, 0x38])) return "image/gif";
  if (startsWith([0x52, 0x49, 0x46, 0x46]) && startsWith([0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  return null;
}

const EXTENSIONS: Record<FeedbackAttachmentType, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

export function feedbackAttachmentObjectKey(
  feedbackId: string,
  attachmentId: string,
  contentType: FeedbackAttachmentType
): string {
  return `feedback/${feedbackId}/${attachmentId}.${EXTENSIONS[contentType]}`;
}

export function parseFeedbackAttachmentSource(value: unknown): FeedbackAttachmentSource {
  return includes(FEEDBACK_ATTACHMENT_SOURCES, value) ? value : "UPLOAD";
}

export function normalizeOptionalText(
  value: unknown,
  max: number,
  label: string
): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") {
    throw new FeedbackValidationError(`${label} must be text.`);
  }
  const text = value.replace(/\r\n/g, "\n").trim();
  if (text.length > max) {
    throw new FeedbackValidationError(
      `${label} must be ${max.toLocaleString("en")} characters or fewer.`
    );
  }
  return text || null;
}

export function normalizeResolutionUrl(value: unknown): string | null {
  const text = normalizeOptionalText(value, MAX_RESOLUTION_URL_LENGTH, "The link");
  if (!text) return null;
  try {
    const url = new URL(text);
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
  } catch {
    // Fall through to the shared error.
  }
  throw new FeedbackValidationError("The link must be a full http(s) address.");
}

export function isClosedFeedbackStatus(status: FeedbackStatus): boolean {
  return status === "RESOLVED" || status === "DECLINED";
}
