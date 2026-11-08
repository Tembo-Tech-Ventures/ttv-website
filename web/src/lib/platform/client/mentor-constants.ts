import type { MentorArea, MentorRequestFormat } from "../contracts";

/*
 * The mentor contract's few values that client code needs, without zod: an
 * island that imports a schema's value pulls the whole schema library in with
 * it. contracts.ts stays the source of truth; mentor-constants.test.ts holds
 * these to it.
 */

/** Every way a mentor can help, in the contract's order (`MentorRequestFormat.options`). */
export const MENTOR_REQUEST_FORMATS = ["WRITTEN_REVIEW", "CALL_30_MIN", "QUICK_QUESTION"] as const satisfies readonly MentorRequestFormat[];

/** The most items "Worth another look" lists (`WORTH_ANOTHER_LOOK_LIMIT`): at this many, there may be more. */
export const WORTH_ANOTHER_LOOK_LIMIT = 20;

/** The longest area a mentor can list (`MentorArea`). */
const MAX_AREA = 40;

export function isMentorRequestFormat(value: unknown): value is MentorRequestFormat {
  return (MENTOR_REQUEST_FORMATS as readonly unknown[]).includes(value);
}

/** Whether a value passes `MentorArea`: some text, at most MAX_AREA characters. */
export function isMentorArea(value: unknown): value is MentorArea {
  return typeof value === "string" && value.length <= MAX_AREA && value.trim().length > 0;
}
