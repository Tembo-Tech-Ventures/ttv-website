import type { APIContext } from "astro";
import type {
  Conversation, CreateMentorRequest, Me, MentorAvailability, MentorDirectory, MentorDirectoryItem, MentorDirectoryQuery,
  MentorRequestList, MentorRequestListQuery, ProjectEmbed, UpdateMentorAvailability, WorthAnotherLook,
} from "@/lib/platform/contracts";
import { ROUTES } from "@/lib/platform/contracts";
import { directoryQuery, filterDirectory, type DirectoryFilters } from "@/lib/platform/client/mentor-directory";
import { listOwnProjects } from "@/lib/channels/embeds";
import { worthAnotherLook } from "@/lib/mentoring/another-look";
import { DIRECTORY_LIMIT, getAvailability, listMentors } from "@/lib/mentoring/profiles";
import { getConversation, listRequests } from "@/lib/mentoring/requests";
import { mentoringRequest, type MentoringOperation } from "@/lib/mentoring/http";
import type { AnswerIntent } from "./answer-fields";
import type { AnswerBody } from "./answer-post";

/**
 * The mentor pages' one seam to the backend lane (lib/mentoring, B-4.1). Page
 * frontmatter reads through this, so the pages render without JavaScript and
 * from the same functions the API serves. Callers own the `mentor_requests`
 * flag and the browser-session checks (the router has already answered 404
 * while the flag is off); every function here still authorises on its own.
 */
export interface MentorsServer {
  directory(query: MentorDirectoryQuery): Promise<MentorDirectory>;
  /**
   * The directory page's mentors: every listed one (the drawer and suggestions can open any), and the ones
   * these filters match, filtered from that one read with the server's own rules (`filterDirectory`). Only
   * when the list is at DIRECTORY_LIMIT, so matches past it would be missed, does it ask the server again.
   */
  browse(filters: DirectoryFilters): Promise<{ all: MentorDirectory; shown: readonly MentorDirectoryItem[] }>;
  requests(query: MentorRequestListQuery): Promise<MentorRequestList>;
  availability(): Promise<MentorAvailability>;
  /** The caller's own published projects, which the drawer can attach. */
  projects(): Promise<ProjectEmbed[]>;
  /** A private conversation's header: the other member and the accepted request that opened it. Members only. */
  conversation(channelId: string): Promise<Conversation | null>;
  /** Work this mentor confirmed at an earlier revision that has a newer one (B-4.2). */
  anotherLook(): Promise<WorthAnotherLook>;
  /** Asks for time without JavaScript, through the API's own handler (request-post.ts). */
  create(body: CreateMentorRequest): Promise<Response>;
  /** Saves this mentor's availability without JavaScript, through the API's own handler (availability-post.ts). */
  saveAvailability(body: UpdateMentorAvailability): Promise<Response>;
  /** Answers a waiting request without JavaScript, through the API's own handler (answer-post.ts). */
  answer(intent: AnswerIntent, requestId: string, body: AnswerBody): Promise<Response>;
}

const ANSWER_OPERATIONS: Record<AnswerIntent, MentoringOperation> = {
  accept: "acceptMentorRequest", redirect: "redirectMentorRequest", decline: "declineMentorRequest", report: "reportMentorRequest",
};

export function mentorsServer(
  context: Pick<APIContext, "locals" | "url">, env: Env, me: Me, now: number = Date.now(),
): MentorsServer {
  const db = env.DB;
  // The API's own handler, given this page's same-origin post (checked by request-post.ts and answer-post.ts)
  // as an inner request that carries that origin.
  const viaApi = (operation: MentoringOperation, path: string, body: unknown, params: Record<string, string> = {}) => {
    const request = new Request(new URL(path, context.url), {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: context.url.origin },
      body: JSON.stringify(body),
    });
    return mentoringRequest(operation, { request, locals: context.locals, params }, env);
  };
  const ctx = { db, viewerId: me.user.id, now };
  return {
    directory: (query) => listMentors(db, me.user.id, query, now),
    async browse(filters) {
      const all = await listMentors(db, me.user.id, {}, now);
      const filtered = Boolean(filters.area || filters.format || filters.available);
      if (!filtered) return { all, shown: all.items };
      if (all.items.length < DIRECTORY_LIMIT) return { all, shown: filterDirectory(all.items, filters) };
      return { all, shown: (await listMentors(db, me.user.id, directoryQuery(filters), now)).items };
    },
    requests: (query) => listRequests(ctx, query),
    availability: () => getAvailability(db, me.user.id, now),
    projects: () => listOwnProjects(db, me.user.id),
    conversation: (channelId) => getConversation(ctx, channelId),
    anotherLook: () => worthAnotherLook({ db, env, locals: context.locals }),
    // The same handler as POST /api/mentor-requests.
    create: (body) => viaApi("createMentorRequest", ROUTES.createMentorRequest.path, body),
    // The same handlers as POST /api/mentor-requests/:id/accept, /redirect, /decline and /report.
    answer(intent, requestId, body) {
      const operation = ANSWER_OPERATIONS[intent];
      return viaApi(operation, ROUTES[operation].path.replace(":id", encodeURIComponent(requestId)), body, { id: requestId });
    },
    saveAvailability(body) {
      // The same handler as PUT /api/mentoring/availability, from the page's own same-origin post.
      const request = new Request(new URL(ROUTES.updateMentorAvailability.path, context.url), {
        method: "PUT",
        headers: { "Content-Type": "application/json", Origin: context.url.origin },
        body: JSON.stringify(body),
      });
      return mentoringRequest("updateMentorAvailability", { request, locals: context.locals, params: {} }, env);
    },
  };
}

