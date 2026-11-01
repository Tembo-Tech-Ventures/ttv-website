import { Cursor, ModerationActionKind, ModerationQueueState, type ModerationActionKind as ActionKind } from "@/lib/platform/contracts";
import { DECIDED_NOTICE, type ModerationCase } from "./case-model";
import { isDecisionRefusal, parseDecisionForm, refusalMessage, refusalStatus } from "./decision-form";

/*
 * One request to the moderation queue (U-2.4), for /admin/moderation and its DEV harness alike:
 * read the tab and page from the address, decide a posted form, and say what to render. The page
 * plugs in the backend's queue and decision; the harness plugs in its fixtures. Either way a
 * decision redirects only once it is recorded, and a refusal renders the case with the reason.
 */

export interface QueueSource {
  list(input: { state: ModerationQueueState; cursor?: string }): Promise<{ items: ModerationCase[]; nextCursor: string | null }>;
  countPending(): Promise<number>;
  /** Records the decision, or throws an error carrying the HTTP status it was refused with. */
  decide(input: { messageId: string; action: ActionKind; reason: string }): Promise<unknown>;
  /** True for the error list throws when a cursor is stale or forged. */
  isBadCursor(error: unknown): boolean;
}

export interface QueuePaths {
  /** The first page of a tab. */
  tab(state: ModerationQueueState): string;
  /** A page of a tab. */
  page(state: ModerationQueueState, cursor: string): string;
  /** Where a recorded decision lands: the tab it was made on, announcing it. */
  decided(state: ModerationQueueState, action: ActionKind): string;
}

export interface QueueViewProps {
  state: ModerationQueueState;
  items: ModerationCase[];
  pendingCount: number;
  formAction: string;
  tabHrefs: Record<ModerationQueueState, string>;
  nextHref: string | null;
  paged: boolean;
  notice?: string;
  failure?: string;
  rowError?: { id: string; message: string; draft: string };
}

export type QueueOutcome =
  | { kind: "redirect"; location: string }
  | { kind: "page"; status: number; props: QueueViewProps };

export async function moderationQueueRequest(request: Request, url: URL, source: QueueSource, paths: QueuePaths): Promise<QueueOutcome> {
  const search = url.searchParams;
  const state = ModerationQueueState.safeParse(search.get("state")).data ?? "PENDING";
  const cursor = Cursor.safeParse(search.get("cursor")).data;
  const formAction = cursor ? paths.page(state, cursor) : paths.tab(state);
  let status = 200;
  let failure: string | undefined;
  let rowError: QueueViewProps["rowError"];

  if (request.method === "POST") {
    const parsed = parseDecisionForm(await request.formData());
    if (!parsed.ok) {
      status = 400;
      if (parsed.messageId) rowError = { id: parsed.messageId, message: parsed.error, draft: parsed.reason };
      else failure = parsed.error;
    } else {
      try {
        await source.decide(parsed);
        return { kind: "redirect", location: paths.decided(state, parsed.action) };
      } catch (error) {
        if (!isDecisionRefusal(error)) throw error;
        status = refusalStatus(error);
        rowError = { id: parsed.messageId, message: refusalMessage(error), draft: parsed.reason };
      }
    }
  }

  let page;
  try {
    page = await source.list({ state, cursor });
  } catch (error) {
    if (!source.isBadCursor(error)) throw error;
    return { kind: "redirect", location: paths.tab(state) };
  }
  // A refused case that is no longer on this page (decided by someone else, say) still says why.
  if (rowError && !page.items.some((item) => item.id === rowError?.id)) {
    failure = rowError.message;
    rowError = undefined;
  }
  const decided = request.method === "GET" ? ModerationActionKind.safeParse(search.get("decided")).data : undefined;

  return {
    kind: "page",
    status,
    props: {
      state,
      items: page.items,
      pendingCount: await source.countPending(),
      formAction,
      tabHrefs: { PENDING: paths.tab("PENDING"), DECIDED: paths.tab("DECIDED") },
      nextHref: page.nextCursor ? paths.page(state, page.nextCursor) : null,
      paged: Boolean(cursor),
      notice: decided && !failure ? DECIDED_NOTICE[decided] : undefined,
      failure,
      rowError,
    },
  };
}

/** The page's own addresses. */
export function queuePaths(base: string): QueuePaths {
  const at = (query: Record<string, string>) => {
    const search = new URLSearchParams(query).toString();
    return search ? `${base}?${search}` : base;
  };
  const tabQuery = (state: ModerationQueueState): Record<string, string> => (state === "PENDING" ? {} : { state });
  return {
    tab: (state) => at(tabQuery(state)),
    page: (state, cursor) => at({ ...tabQuery(state), cursor }),
    decided: (state, action) => at({ ...tabQuery(state), decided: action }),
  };
}
