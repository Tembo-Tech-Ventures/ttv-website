import { ROUTES, SearchQuery, SearchResults } from "../contracts";
import { searchResults } from "../fixtures";
import { createApiClient } from "./apiClient";
import { createMockTransport } from "./mockTransport";

/** Explicit fixture mode for the UI lane before B-1.4 exists. Never an error fallback. */
export function createSearchMockClient() {
  return createApiClient({ fetch: createMockTransport([{
    method: ROUTES.search.method, path: ROUTES.search.path,
    reply: ({ request }) => {
      const params = new URL(request.url).searchParams;
      const query = SearchQuery.parse(Object.fromEntries(params));
      return { data: SearchResults.parse({ ...searchResults, query, messages: [],
        people: ["all", "people", "community"].includes(query.scope) ? searchResults.people : [],
        projects: ["all", "projects", "community"].includes(query.scope) ? searchResults.projects : [],
        sessionMoments: ["all", "cohort", "sessionMoments"].includes(query.scope)
          ? searchResults.sessionMoments.filter(item => !query.programId || item.programId === query.programId) : [],
      }) };
    },
  }]) });
}
