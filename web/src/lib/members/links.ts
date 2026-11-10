import { MEMBERS_PATH } from "@/lib/platform/server/space-routes";

/**
 * Where the app links a member: their page in the Members directory, for everyone signed in,
 * graduates included (their member page links on to /talent). Every in-app surface that names a
 * member links through here (search, Tembo's citations, the profile overview), so they cannot
 * drift apart. Callers pass only people the shared eligibility rule lists, so the page is there.
 * Public surfaces never use this: they keep /talent and never point into the app.
 */
export function memberProfileHref(member: { handle: string }): string {
  return `${MEMBERS_PATH}/${encodeURIComponent(member.handle)}`;
}

/** One piece of a member's posted work, on their page (WorkItem's `work-<id>` heading). */
export function memberWorkHref(member: { handle: string }, workId: string): string {
  return `${memberProfileHref(member)}#work-${encodeURIComponent(workId)}`;
}
