import type { AstroGlobal } from "astro";
import { env } from "cloudflare:workers";
import type { Channel, ChannelShareables, ConductAcknowledgement, Me } from "@/lib/platform/contracts";
import type { ChannelPage } from "@/lib/channels/page";
import { isAgentSession } from "@/lib/agent-auth";
import { getRouteChannel, getRouteChannelPage, getRouteChannelShareables } from "@/lib/platform/server/channel-context";
import type { ChannelSpace } from "@/lib/platform/server/space-routes";
import { resolveSpacePageWith, type SpacePageContext } from "@/components/platform/spaces/space-page";
import type { SpacePageKey } from "@/components/platform/spaces/sidebar";
import { conductAgreed, handleConductPost } from "./conduct-flow";
import { CHANNEL_MESSAGES_ID, channelSpace } from "./paths";
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
  403: "That request was refused.",
  404: "Not found.",
  405: "Not allowed.",
  413: "That form was too large.",
};
/** Why an agent's delegated session may not post the form, rather than the generic refusal. */
export const AGENT_REFUSAL = "Only the person can agree to how we talk to each other.";
const respond = (status: number, headers: Record<string, string> = {}, reason = REASON[status]) =>
  new Response(reason ?? null, { status, headers: { ...PRIVATE, ...(reason ? { "Content-Type": "text/plain; charset=utf-8" } : {}), ...headers } });

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

/**
 * What a conversation shows once its habits are agreed, read with the page's frame rather than after
 * it (PERF-2): the first page of messages (null when it is not this person's to read) and what the
 * composer can attach (null hides the attach tools).
 */
export interface ChannelPageView {
  channel: Channel;
  first: { channel: Channel; page: ChannelPage } | null;
  shareables: ChannelShareables | null;
}

async function resolve<T extends object>(
  astro: AstroGlobal,
  page: SpacePageKey,
  find: (me: Me) => Promise<T | null>,
): Promise<(ChannelsPage & T) | Response> {
  const { method } = astro.request;
  const allowed = method === "GET" || method === "HEAD" || method === "POST";
  // Started beside onboarding once `channels` is known to be on (PERF-2). A GET also reads the
  // person's own agreement, which says nothing about this channel; a POST reads it after its write.
  const resolved = await resolveSpacePageWith(astro.locals, page, (me) => me.flags.channels && allowed
    ? Promise.all([channelsServer(env.DB, me).list(), find(me), method === "POST" ? null : channelsServer(env.DB, me).conduct.load()])
    : Promise.resolve(null));
  if (!resolved?.[0].me.flags.channels) return respond(404);
  const [context, loaded] = resolved;
  // Null only for a method other than GET, HEAD or POST.
  if (!loaded) return respond(405, { Allow: "GET, HEAD, POST" });
  const server = channelsServer(env.DB, context.me);
  const [readable, found, earlyRecord] = loaded;
  if (!found) return respond(404);

  const self = astro.url.pathname + astro.url.search;
  const canAgree = !isAgentSession(astro.locals.session?.userAgent);
  if (method === "POST" && !canAgree) return respond(403, {}, AGENT_REFUSAL);
  // From a channel's own gate, back to its messages; from the habits' page, back to the habits.
  const posted = await handleConductPost(astro.request, server.conduct, "channel" in found ? `${self}#${CHANNEL_MESSAGES_ID}` : self);
  if (posted) return posted.kind === "redirect" ? respond(303, { Location: posted.location }) : respond(posted.status);
  const record = method === "POST" ? await server.conduct.load() : earlyRecord;
  return { context, readable, record, agreed: conductAgreed(record), canAgree, self, ...found };
}

/**
 * The route channel's view, once it is known to belong on this page. Its reads chain off the one
 * cached channel lookup, so they run beside the conduct record and onboarding: on a first visit, when
 * the habits show instead, they are simply not rendered. A POST only agrees and redirects.
 */
async function loadView(astro: AstroGlobal, channel: Channel): Promise<ChannelPageView> {
  if (astro.request.method === "POST") return { channel, first: null, shareables: null };
  const [first, shareables] = await Promise.all([getRouteChannelPage(astro), loadRouteShareables(astro)]);
  return { channel, first, shareables };
}

/** A channel's page in its space: `/dashboard/community/c/:slug` or `/dashboard/cohort/c/:slug`. */
export async function resolveChannelPage(astro: AstroGlobal, space: ChannelSpace): Promise<(ChannelsPage & ChannelPageView) | Response> {
  return resolve(astro, space === "cohort" ? "cohortChannel" : "communityChannel", async () => {
    const channel = await getRouteChannel(astro);
    return channel && channelSpace(channel) === space ? loadView(astro, channel) : null;
  });
}

/**
 * A private conversation's page, `/dashboard/community/dm/:id` (U-4.1): only a DIRECT channel this
 * person is a member of; any other id is not found, exactly like one that does not exist. `header`
 * reads what the page's own header shows (who it is with), beside the view.
 */
export async function resolveConversationPage<H>(
  astro: AstroGlobal,
  header: (me: Me, channel: Channel) => Promise<H>,
): Promise<(ChannelsPage & ChannelPageView & { header: H }) | Response> {
  return resolve(astro, "conversation", async (me) => {
    const channel = await getRouteChannel(astro);
    if (channel?.kind !== "DIRECT") return null;
    const [view, read] = await Promise.all([loadView(astro, channel), header(me, channel)]);
    return { ...view, header: read };
  });
}

/** "How we talk to each other" at CONDUCT_PATH. Agreeing here keeps the person on the page, now with the date. */
export async function resolveConductPage(astro: AstroGlobal): Promise<ChannelsPage | Response> {
  return resolve(astro, "conduct", async () => ({}));
}

/**
 * What the route channel's composer can attach (B-2.4), or null, which shows no attach tools. The
 * conversation matters more than the tools: when loading them fails the page still renders, without them.
 */
export async function loadRouteShareables(astro: Pick<AstroGlobal, "locals" | "url">): Promise<ChannelShareables | null> {
  try {
    return await getRouteChannelShareables(astro);
  } catch (error) {
    console.error("Channel page: shareables unavailable, attach tools hidden", error);
    return null;
  }
}
