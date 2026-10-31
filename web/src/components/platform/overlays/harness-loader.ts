import { useState } from "react";
import type { ApiClient } from "@/lib/platform/client/apiClient";
import type { HarnessScenario } from "./harness-clients";

export type HarnessClients = { attention: ApiClient; search: ApiClient };

/** A client that loads the real one on first use, so harness code is fetched only when a harness runs. */
function lazyClient(load: () => Promise<ApiClient>): ApiClient {
  let client: Promise<ApiClient> | undefined;
  return { call: (route, options) => (client ??= load()).then((loaded) => loaded.call(route, options)) };
}

/**
 * Fixture clients for the DEV harness's scenario, or null: always null in a
 * production build, where `import.meta.env.DEV` is false and the harness
 * module is dropped. Island props must be serialisable, so harness pages pass
 * the scenario's name and the island builds its clients here.
 */
export function useHarnessClients(scenario: HarnessScenario | undefined): HarnessClients | null {
  const [clients] = useState<HarnessClients | null>(() => {
    if (!import.meta.env.DEV || !scenario) return null;
    const harness = import("./harness-clients");
    return {
      attention: lazyClient(() => harness.then((module) => module.harnessAttentionClient(scenario))),
      search: lazyClient(() => harness.then((module) => module.harnessSearchClient(scenario))),
    };
  });
  return clients;
}
