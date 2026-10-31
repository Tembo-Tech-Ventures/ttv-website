import { AttentionFilter, AttentionList, MarkAttentionRead, ROUTES, type AttentionItem, type AttentionCount } from "../contracts";
import { attention as fixtureAttention } from "../fixtures";
import { createApiClient, type ApiClient } from "./apiClient";
import { createMockTransport } from "./mockTransport";

const zeroCounts = (): AttentionCount => ({ count: 0, unreadCounts: {
  cohort: 0, community: 0, mentoring: 0, discover: 0, admin: 0, profile: 0,
} });
const matches = (item: AttentionItem, body: MarkAttentionRead) => "ids" in body
  ? body.ids.includes(item.id) : item.createdAt <= body.through;

/** Same grouping as the attention API; mock data never falls back to the network. */
export function attentionMatchesFilter(item: AttentionItem, filter: AttentionFilter): boolean {
  if (filter === "all") return true;
  if (filter === "mentions") return ["mention", "reply", "tembo_answer"].includes(item.kind);
  if (filter === "requests") return item.kind.startsWith("mentor_");
  return !attentionMatchesFilter(item, "mentions") && !attentionMatchesFilter(item, "requests");
}

export function createAttentionMockClient(): ApiClient {
  let items = AttentionList.parse(fixtureAttention).items;
  const count = () => {
    const result = zeroCounts();
    for (const item of items) if (item.readAt === null) { result.count++; result.unreadCounts[item.space]++; }
    return result;
  };
  return createApiClient({ fetch: createMockTransport([
    { ...ROUTES.listAttention, reply: ({ request }) => {
      const filter = AttentionFilter.parse(new URL(request.url).searchParams.get("filter") ?? "all");
      return { data: { ...fixtureAttention, items: items.filter(item => attentionMatchesFilter(item, filter)) } };
    } },
    { ...ROUTES.countAttention, reply: () => ({ data: count() }) },
    { ...ROUTES.markAttentionRead, reply: async ({ request }) => {
      const body = MarkAttentionRead.parse(await request.json());
      items = items.map(item => item.readAt === null && matches(item, body) ? { ...item, readAt: Date.now() } : item);
      return { data: count() };
    } },
  ]) });
}
