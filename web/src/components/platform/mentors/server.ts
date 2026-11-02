import type { APIContext } from "astro";
import type {
  Conversation, CreateMentorRequest, Me, MentorAvailability, MentorDirectory, MentorDirectoryQuery, MentorRequestList,
  MentorRequestListQuery, ProjectEmbed, WorthAnotherLook,
} from "@/lib/platform/contracts";
import { ROUTES } from "@/lib/platform/contracts";
import { listOwnProjects } from "@/lib/channels/embeds";
import { worthAnotherLook } from "@/lib/mentoring/another-look";
import { getAvailability, listMentors } from "@/lib/mentoring/profiles";
import { getConversation, IS_MEMBER, listRequests } from "@/lib/mentoring/requests";
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
  /**
   * Whether this person may ask a mentor for time: a member account, meaning a community profile or a
   * cohort place (B-4.1's IS_MEMBER, the same condition the API's INSERT checks).
   */
  canAsk(): Promise<boolean>;
  /** A private conversation's header: the other member and the accepted request that opened it. Members only. */
  conversation(channelId: string): Promise<Conversation | null>;
  /** Work this mentor confirmed at an earlier revision that has a newer one (B-4.2). */
  anotherLook(): Promise<WorthAnotherLook>;
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
    conversation: (channelId) => getConversation(ctx, channelId),
    anotherLook: () => worthAnotherLook({ db, env, locals: context.locals }),
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

