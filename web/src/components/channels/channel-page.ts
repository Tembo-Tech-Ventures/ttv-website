import type { AstroGlobal } from "astro";
import { env } from "cloudflare:workers";
import type { Channel, ConductAcknowledgement } from "@/lib/platform/contracts";
import { isAgentSession } from "@/lib/agent-auth";
import { getRouteChannel } from "@/lib/platform/server/channel-context";
import type { ChannelSpace } from "@/lib/platform/server/space-routes";
import { resolveSpacePage, type SpacePageContext } from "@/components/platform/spaces/space-page";
import type { SpacePageKey } from "@/components/platform/spaces/sidebar";
import { conductAgreed, handleConductPost } from "./conduct-flow";
import { channelSpace } from "./paths";
import { channelsServer } from "./server";

/**
 * What a channel page or the conduct page needs, decided once in the page's
 * frontmatter: a Response to return as it is (not found, refused, or the
 * redirect after agreeing), or what to render.
 *
 * - Not found unless the spaces shell is open to this person in the page's
 *   space and `channels` is on for them; then a channel exists here only if
 *   the backend finds it as one they can read (the router already answers
 *   404 otherwise, from the same cached lookup). A channel they cannot read
 *   looks exactly like one that does not exist.
 * - Agreeing to the habits is a person's own act: an agent's delegated
 *   session may read, but never posts it for them.
 */

const PRIVATE = { "Cache-Control": "no-store", Vary: "Cookie" } as const;
/** A refusal says what happened in words; a redirect has no body. */
const REASON: Record<number, string> = {
  400: "That form could not be read.",
  403: "Only the person can agree to how we talk to each other.",
  404: "Not found.",
  405: "Not allowed.",
  413: "That form was too large.",
};
const respond = (status: number, headers: Record<string, string> = {}) =>
  new Response(REASON[status] ?? null, { status, headers: { ...PRIVATE, ...(REASON[status] ? { "Content-Type": "text/plain; charset=utf-8" } : {}), ...headers } });

export interface ChannelsPage {
  context: SpacePageContext;
  /** Every channel this person can read, for the sidebar. */
  readable: readonly Channel[];
  record: ConductAcknowledgement | null;
  agreed: boolean;
  /** False for an agent's delegated session, which may read the habits but never agree for the person. */
  canAgree: boolean;
  /** This page with its query: where agreeing posts and returns. */
  self: string;
}

async function resolve<T extends object>(
  astro: AstroGlobal,
  page: SpacePageKey,
  find: () => Promise<T | null>,
): Promise<(ChannelsPage & T) | Response> {
  const context = await resolveSpacePage(astro.locals, page);
  if (!context?.me.flags.channels) return respond(404);
  const { method } = astro.request;
  if (method !== "GET" && method !== "HEAD" && method !== "POST") return respond(405, { Allow: "GET, HEAD, POST" });
  const server = channelsServer(env.DB, context.me);
  const [readable, found] = await Promise.all([server.list(), find()]);
  if (!found) return respond(404);

  const self = astro.url.pathname + astro.url.search;
  const canAgree = !isAgentSession(astro.locals.session?.userAgent);
  if (method === "POST" && !canAgree) return respond(403);
  const posted = await handleConductPost(astro.request, server.conduct, self);
  if (posted) return posted.kind === "redirect" ? respond(303, { Location: posted.location }) : respond(posted.status);
  const record = await server.conduct.load();
  return { context, readable, record, agreed: conductAgreed(record), canAgree, self, ...found };
}

/** A channel's page in its space: `/dashboard/community/c/:slug` or `/dashboard/cohort/c/:slug`. */
export async function resolveChannelPage(astro: AstroGlobal, space: ChannelSpace): Promise<(ChannelsPage & { channel: Channel }) | Response> {
  return resolve(astro, space === "cohort" ? "cohortChannel" : "communityChannel", async () => {
    const channel = await getRouteChannel(astro);
    return channel && channelSpace(channel) === space ? { channel } : null;
  });
}

/** "How we talk to each other" at CONDUCT_PATH. Agreeing here keeps the person on the page, now with the date. */
export async function resolveConductPage(astro: AstroGlobal): Promise<ChannelsPage | Response> {
  return resolve(astro, "conduct", async () => ({}));
}
