import { AttentionList, type Me, type SpaceId } from "@/lib/platform/contracts";
import { readLastSpaceCookie, selectDefaultSpace } from "@/lib/platform/client/spaces-selection";
import { canRenderSpace } from "@/components/platform/shell/access";

export type AttentionPageData = { kind: "missing" } | { kind: "page"; me: Me; space: SpaceId; initialList?: AttentionList };

type Sources = {
  /** getSpaceContext: throws a Response when the flag is off, the person is signed out, or a token is used. */
  context: () => Promise<Me>;
  /** The request's Cookie header, read here only for the last-space preference. */
  cookie: string | null;
  /** The first page of attention, from the attention service. */
  list: (me: Me) => Promise<AttentionList>;
};

/**
 * What the attention page renders, or that it does not exist. Denials (the
 * `spaces` flag off, no session, a personal access token) make the page
 * missing, not an error; other failures loading context propagate. The list
 * is best effort: if it cannot be read here, the island loads it and says so
 * plainly if that fails too. Only contract fields leave this function.
 */
export async function attentionPageData({ context, cookie, list }: Sources): Promise<AttentionPageData> {
  let me: Me;
  try {
    me = await context();
  } catch (denied) {
    if (denied instanceof Response) return { kind: "missing" };
    throw denied;
  }
  const space = selectDefaultSpace(me.spaces, { lastSpace: readLastSpaceCookie(cookie) });
  if (!space || !canRenderSpace(me, space)) return { kind: "missing" };
  try {
    return { kind: "page", me, space, initialList: AttentionList.parse(await list(me)) };
  } catch {
    return { kind: "page", me, space };
  }
}
