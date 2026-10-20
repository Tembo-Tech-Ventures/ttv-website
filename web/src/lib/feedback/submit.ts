import { createId } from "@paralleldrive/cuid2";
import {
  FeedbackValidationError,
  MAX_FEEDBACK_ATTACHMENT_BYTES,
  MAX_FEEDBACK_ATTACHMENTS,
  MAX_FEEDBACK_PER_DAY,
  feedbackAttachmentObjectKey,
  normalizeFeedbackMessage,
  normalizeFeedbackPageTitle,
  normalizeFeedbackPageUrl,
  parseFeedbackAttachmentSource,
  parseFeedbackKind,
  sanitizeFeedbackContext,
  sniffFeedbackImageType,
} from "./model";
import {
  countRecentFeedback,
  insertFeedback,
  type NewFeedbackAttachment,
} from "./store";

export class FeedbackRateLimitError extends Error {
  constructor() {
    super(
      `You have sent ${MAX_FEEDBACK_PER_DAY} notes in the last day. Thank you! Please try again tomorrow.`
    );
    this.name = "FeedbackRateLimitError";
  }
}

export interface SubmitFeedbackInput {
  formData: FormData;
  userId: string;
  requestUrl: string;
  appVersion?: string | null;
}

export interface SubmitFeedbackDeps {
  db: D1Database;
  bucket: Pick<R2Bucket, "put" | "delete">;
  now?: Date;
  newId?: () => string;
}

interface PreparedAttachment {
  bytes: Uint8Array;
  record: NewFeedbackAttachment;
}

async function prepareAttachments(
  formData: FormData,
  feedbackId: string,
  newId: () => string
): Promise<PreparedAttachment[]> {
  const files = formData
    .getAll("attachments")
    .filter((entry): entry is File => typeof entry !== "string" && entry.size > 0);
  const sources = formData.getAll("attachmentSources");
  if (files.length > MAX_FEEDBACK_ATTACHMENTS) {
    throw new FeedbackValidationError(
      `Attach up to ${MAX_FEEDBACK_ATTACHMENTS} images.`
    );
  }

  return Promise.all(
    files.map(async (file, position) => {
      if (file.size > MAX_FEEDBACK_ATTACHMENT_BYTES) {
        throw new FeedbackValidationError(
          `Each image must be ${MAX_FEEDBACK_ATTACHMENT_BYTES / 1024 / 1024} MB or smaller.`
        );
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      const contentType = sniffFeedbackImageType(bytes);
      if (!contentType) {
        throw new FeedbackValidationError(
          "Attachments must be PNG, JPG, WebP or GIF images."
        );
      }
      const id = newId();
      return {
        bytes,
        record: {
          id,
          objectKey: feedbackAttachmentObjectKey(feedbackId, id, contentType),
          contentType,
          size: bytes.byteLength,
          source: parseFeedbackAttachmentSource(sources[position]),
          position,
        },
      };
    })
  );
}

/**
 * Validates a widget submission, stores its images in R2 and records it in D1.
 *
 * Images go up first so a D1 row never points at a missing object; if the
 * insert then fails, the orphaned objects are removed before the error is
 * rethrown.
 */
export async function submitFeedback(
  { formData, userId, requestUrl, appVersion = null }: SubmitFeedbackInput,
  { db, bucket, now = new Date(), newId = createId }: SubmitFeedbackDeps
): Promise<{ id: string }> {
  const kind = parseFeedbackKind(formData.get("kind"));
  const message = normalizeFeedbackMessage(formData.get("message"));
  const pageUrl = normalizeFeedbackPageUrl(formData.get("pageUrl"), requestUrl);
  const pageTitle = normalizeFeedbackPageTitle(formData.get("pageTitle"));
  const context = sanitizeFeedbackContext(formData.get("context"));

  const id = newId();
  const attachments = await prepareAttachments(formData, id, newId);
  if (!message && attachments.length === 0) {
    throw new FeedbackValidationError(
      "Tell us a little about it, or add a screenshot."
    );
  }

  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
  if ((await countRecentFeedback(db, userId, dayAgo)) >= MAX_FEEDBACK_PER_DAY) {
    throw new FeedbackRateLimitError();
  }

  const uploaded: string[] = [];
  try {
    for (const { bytes, record } of attachments) {
      await bucket.put(record.objectKey, bytes, {
        httpMetadata: { contentType: record.contentType },
        customMetadata: { feedbackId: id, userId },
      });
      uploaded.push(record.objectKey);
    }
    await insertFeedback(
      db,
      {
        id,
        userId,
        kind,
        message,
        pageUrl,
        pageTitle,
        context,
        appVersion,
        attachments: attachments.map(({ record }) => record),
      },
      now
    );
  } catch (error) {
    if (uploaded.length > 0) {
      await bucket.delete(uploaded).catch(() => undefined);
    }
    throw error;
  }

  return { id };
}
