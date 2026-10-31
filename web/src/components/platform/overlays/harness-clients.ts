/**
 * DEV harness only (`/dev/platform-overlays`): fixture-backed API clients for
 * the attention and search overlays, with scenarios for the states a real
 * network produces: slow answers, failures that recover on retry, an expired
 * session, the spaces flag off, an empty inbox and a long one. Never imported
 * by production code: PlatformOverlays loads it lazily behind
 * `import.meta.env.DEV`, so production builds drop it.
 */
import {
  AttentionFilter,
  AttentionList,
  MarkAttentionRead,
  ROUTES,
  SearchQuery,
  SearchResults,
  SPACE_ORDER,
  type AttentionCount,
  type AttentionItem,
  type AttentionKind,
  type SpaceId,
} from "@/lib/platform/contracts";
import { attention as fixtureAttention, FIXTURE_NOW, people, searchResults } from "@/lib/platform/fixtures";
import { createApiClient, type ApiClient } from "@/lib/platform/client/apiClient";
import { attentionMatchesFilter } from "@/lib/platform/client/attention.mock";
import { createMockTransport, type MockReply } from "@/lib/platform/client/mockTransport";

export const HARNESS_SCENARIOS = ["default", "slow", "empty", "many", "error", "readfail", "expired", "off", "arrivals"] as const;
export type HarnessScenario = (typeof HARNESS_SCENARIOS)[number];

export function isHarnessScenario(value: string | null): value is HarnessScenario {
  return (HARNESS_SCENARIOS as readonly string[]).includes(value ?? "");
}

const PAGE = 30;
/** Fails the first attempts at something, including the client's own two retries, then recovers. */
const FAILING_ATTEMPTS = 3;

const expired: MockReply = { status: 401, data: { error: { code: "forbidden", message: "Sign in again." } } };
const flagOff: MockReply = { status: 404, data: { error: { code: "flag_off", message: "Not found." } } };
const broken: MockReply = { status: 500, data: { error: { code: "server", message: "Something went wrong." } } };

function latency(scenario: HarnessScenario): number {
  return scenario === "slow" ? 1_500 : 120;
}

/** The fixture inbox, moved so its times are relative to now rather than to the fixture's clock. */
function inbox(scenario: HarnessScenario, now: number): AttentionItem[] {
  if (scenario === "empty") return [];
  const shift = (time: number) => time - FIXTURE_NOW + now;
  const items = fixtureAttention.items.map((item) => ({
    ...item,
    createdAt: shift(item.createdAt),
    readAt: item.readAt === null ? null : shift(item.readAt),
  }));
  if (scenario !== "many") return items;
  const kinds: AttentionKind[] = ["reply", "recording_ready", "work_confirmed", "mention"];
  const spaces: SpaceId[] = ["community", "cohort", "profile", "cohort"];
  const older = Array.from({ length: 40 }, (_, index): AttentionItem => ({
    id: `harness-older-${String(index).padStart(2, "0")}`,
    kind: kinds[index % kinds.length],
    space: spaces[index % spaces.length],
    actor: index % 2 === 0 ? people.kevin : null,
    subject: { kind: "message", id: `harness-subject-${index}`, href: "/dev/platform-overlays#older", label: "#help" },
    summary: index % 2 === 0 ? "Kevin Omondi replied in #help" : `Older update ${index + 1}`,
    createdAt: now - (3 + index) * 86_400_000,
    readAt: now - (2 + index) * 86_400_000,
  }));
  return [...items, ...older];
}

function count(items: readonly AttentionItem[]): AttentionCount {
  const unreadCounts = Object.fromEntries(SPACE_ORDER.map((space) => [space, 0])) as Record<SpaceId, number>;
  let total = 0;
  for (const item of items) {
    if (item.readAt !== null) continue;
    unreadCounts[item.space]++;
    total++;
  }
  return { count: total, unreadCounts };
}

/** The scenario's first page, for the attention page to render on the server. */
export function harnessAttentionPage(scenario: HarnessScenario): AttentionList | undefined {
  if (scenario === "expired" || scenario === "off" || scenario === "error") return undefined;
  const now = Date.now();
  const items = inbox(scenario, now);
  return AttentionList.parse({ items: items.slice(0, PAGE), nextCursor: items.length > PAGE ? String(PAGE) : null, snapshotAt: now });
}

export function harnessAttentionClient(scenario: HarnessScenario): ApiClient {
  let items = inbox(scenario, Date.now());
  let listFailures = scenario === "error" ? FAILING_ATTEMPTS : 0;
  let readFailures = scenario === "readfail" ? FAILING_ATTEMPTS : 0;
  let counted = 0;

  const fetch = createMockTransport(
    [
      {
        ...ROUTES.listAttention,
        reply: ({ request }) => {
          const params = new URL(request.url).searchParams;
          const filter = AttentionFilter.parse(params.get("filter") ?? "all");
          const offset = Number(params.get("cursor") ?? 0);
          const matching = items.filter((item) => attentionMatchesFilter(item, filter));
          const page = matching.slice(offset, offset + PAGE);
          const next = offset + PAGE < matching.length ? String(offset + PAGE) : null;
          return { data: AttentionList.parse({ items: page, nextCursor: next, snapshotAt: Date.now() }) };
        },
      },
      {
        ...ROUTES.countAttention,
        reply: () => {
          // "arrivals": from the second count on, someone has mentioned you.
          if (scenario === "arrivals" && ++counted === 2) {
            items = [
              {
                id: "harness-arrival",
                kind: "mention",
                space: "community",
                actor: people.faith,
                subject: { kind: "message", id: "harness-arrival-message", href: "/dev/platform-overlays#arrival", label: "#help" },
                summary: "Faith Njeri mentioned you in #help",
                createdAt: Date.now(),
                readAt: null,
              },
              ...items,
            ];
          }
          return { data: count(items) };
        },
      },
      {
        ...ROUTES.markAttentionRead,
        reply: async ({ request }) => {
          const body = MarkAttentionRead.parse(await request.json());
          const now = Date.now();
          items = items.map((item) =>
            item.readAt === null && ("ids" in body ? body.ids.includes(item.id) : item.createdAt <= body.through)
              ? { ...item, readAt: now }
              : item,
          );
          return { data: count(items) };
        },
      },
    ],
    {
      latencyMs: latency(scenario),
      failure: (request) => {
        if (scenario === "expired") return expired;
        if (scenario === "off") return flagOff;
        const path = new URL(request.url).pathname;
        if (path === ROUTES.listAttention.path && listFailures > 0) {
          listFailures--;
          return broken;
        }
        if (path === ROUTES.markAttentionRead.path && readFailures > 0) {
          readFailures--;
          return broken;
        }
        return undefined;
      },
    },
  );
  return createApiClient({ fetch, retry: { baseDelayMs: 50, maxDelayMs: 100 } });
}

export function harnessSearchClient(scenario: HarnessScenario): ApiClient {
  let failures = scenario === "error" ? FAILING_ATTEMPTS : 0;
  const fetch = createMockTransport(
    [
      {
        method: ROUTES.search.method,
        path: ROUTES.search.path,
        reply: ({ request }) => {
          const query = SearchQuery.parse(Object.fromEntries(new URL(request.url).searchParams));
          // Anything about "nothing" finds nothing, so the empty state can be seen.
          const none = scenario === "empty" || /nothing/i.test(query.q);
          const has = (scopes: string[]) => !none && scopes.includes(query.scope);
          return {
            data: SearchResults.parse({
              query,
              messages: [],
              people: has(["all", "people", "community"]) ? searchResults.people : [],
              projects: has(["all", "projects", "community"]) ? searchResults.projects : [],
              sessionMoments: has(["all", "cohort", "sessionMoments"]) ? searchResults.sessionMoments : [],
            }),
          };
        },
      },
    ],
    {
      latencyMs: scenario === "slow" ? 800 : 80,
      failure: () => {
        if (scenario === "expired") return expired;
        if (scenario === "off") return flagOff;
        if (failures > 0) {
          failures--;
          return broken;
        }
        return undefined;
      },
    },
  );
  return createApiClient({ fetch, retry: { baseDelayMs: 50, maxDelayMs: 100 } });
}
