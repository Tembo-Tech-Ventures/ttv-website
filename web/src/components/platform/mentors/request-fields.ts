import type { ProjectEmbedRef } from "@/lib/platform/contracts";

/*
 * The request drawer's form fields, which the drawer writes and request-post.ts reads. Kept apart from
 * request-post.ts, so the drawer's island ships the names without the server's post handling.
 */

/** The form field that marks this post as a mentor request, so the page can carry the conduct form too. */
export const REQUEST_INTENT = "mentor-request";

/** The form field that agrees to how we talk to each other as the request is sent: the version the drawer showed. */
export const AGREE_FIELD = "agree";

/** A project radio's value: the work and the revision it was offered at. */
export const projectValue = (ref: Pick<ProjectEmbedRef, "journeyId" | "version">) => `${ref.journeyId}@${ref.version}`;
