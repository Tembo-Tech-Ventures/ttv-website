import type { APIContext } from "astro";
import type {
  CreateMentorRequest, Me, MentorAvailability, MentorDirectory, MentorDirectoryQuery, MentorRequest, MentorRequestList,
  MentorRequestListQuery, ProjectEmbed,
} from "@/lib/platform/contracts";
import { ROUTES } from "@/lib/platform/contracts";
import { getAvailability, listMentors } from "@/lib/mentoring/profiles";
import { IS_MEMBER, listRequests } from "@/lib/mentoring/requests";
import { listOwnProjects } from "@/lib/channels/embeds";
import { mentoringRequest } from "@/lib/mentoring/http";

/**
 * The mentor pages' one seam to the backend lane (lib/mentoring, B-4.1). Page
 * frontmatter reads through this, so the pages render without JavaScript and
 * from the same functions the API serves. Callers own the `mentor_requests`
 * flag and the browser-session checks (the router has already answered 404
 * while the flag is off); every function here still authorises on its own.
 */
export interface MentorsServer {
  directory(query: MentorDirectoryQuery): Promise<MentorDirectory>;
  requests(query: MentorRequestListQuery): Promise<MentorRequestList>;
  availability(): Promise<MentorAvailability>;
  /** The caller's own published projects, which the drawer can attach. */
  projects(): Promise<ProjectEmbed[]>;
  /** Whether the caller may ask for time: a member account, as POST /api/mentor-requests checks it (IS_MEMBER). */
  canAsk(): Promise<boolean>;
  /**
   * The accepted request that opened a private conversation, newest first, from either side. Null when
   * staff opened it, or when it is older than the first page of this person's accepted requests.
   */
  openedBy(channelId: string): Promise<MentorRequest | null>;
  /** Asks for time without JavaScript, through the API's own handler (request-post.ts). */
  create(body: CreateMentorRequest): Promise<Response>;
}

export function mentorsServer(
  context: Pick<APIContext, "locals" | "url">, env: Env, me: Me, now: number = Date.now(),
): MentorsServer {
  const db = env.DB;
  const ctx = { db, viewerId: me.user.id, now };
  return {
    directory: (query) => listMentors(db, me.user.id, query, now),
    requests: (query) => listRequests(ctx, query),
    availability: () => getAvailability(db, me.user.id, now),
    projects: () => listOwnProjects(db, me.user.id),
    async canAsk() {
      const row = await db.prepare(`SELECT ${IS_MEMBER("?1")} AS member`).bind(me.user.id).first<{ member: number }>();
      return Boolean(row?.member);
    },
    async openedBy(channelId) {
      const [asked, answered] = await Promise.all([
        listRequests(ctx, { as: "requester", status: "ACCEPTED" }),
        listRequests(ctx, { as: "mentor", status: "ACCEPTED" }),
      ]);
      return [...asked.items, ...answered.items]
        .filter((request) => request.channelId === channelId)
        .toSorted((a, b) => b.updatedAt - a.updatedAt)[0] ?? null;
    },
    create(body) {
      // The same handler as POST /api/mentor-requests. The page has already checked its own post is
      // same-origin (request-post.ts), so this inner request carries that origin.
      const request = new Request(new URL(ROUTES.createMentorRequest.path, context.url), {
        method: "POST",
        headers: { "Content-Type": "application/json", Origin: context.url.origin },
        body: JSON.stringify(body),
      });
      return mentoringRequest("createMentorRequest", { request, locals: context.locals, params: {} }, env);
    },
  };
}

