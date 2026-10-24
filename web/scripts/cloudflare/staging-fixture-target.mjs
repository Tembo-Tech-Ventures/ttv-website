export const STAGING_FIXTURE_DATABASE_ID = "8df53ce1-0e9d-4e51-aaac-329f84cf1d5f";
const targets = new WeakSet();

/** Read-only preflight. The returned executor is permanently bound to staging. */
export async function verifyStagingFixtureTarget({ environmentName, accountId, expectedVersion, baseUrl, api, fetchImpl = fetch }) {
  if (environmentName !== "staging" || !/^[a-f0-9]{32}$/.test(accountId ?? "") || !/^[a-f0-9]{40}$/.test(expectedVersion ?? "")) {
    throw new Error("Exact staging account and deployed revision are required.");
  }
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || url.username || url.password || url.port || url.search || url.hash || url.pathname !== "/" ||
      !/^ttv-website-staging\.[a-z0-9-]+\.workers\.dev$/.test(url.hostname)) {
    throw new Error("Only the shared staging Worker origin is supported.");
  }
  try {
    const account = await api("");
    if (account?.id !== accountId) throw new Error("Account mismatch");
    const settings = await api("/workers/scripts/ttv-website-staging/settings");
    const bindings = settings?.bindings ?? [];
    const binding = (name) => bindings.find((item) => item.name === name);
    if (binding("DB")?.type !== "d1" || binding("DB")?.id !== STAGING_FIXTURE_DATABASE_ID ||
        binding("DEPLOYMENT_ENVIRONMENT")?.text !== "staging" || binding("DEPLOYMENT_VERSION")?.text !== expectedVersion) {
      throw new Error("Worker binding mismatch");
    }
    const database = await api(`/d1/database/${STAGING_FIXTURE_DATABASE_ID}`);
    if (database?.uuid !== STAGING_FIXTURE_DATABASE_ID || database?.name !== "ttv-website-db-staging") throw new Error("Database mismatch");
    const response = await fetchImpl(new URL("/api/health", url), { redirect: "error", signal: globalThis.AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("Health unavailable");
    const health = await response.json();
    if (health.service !== "ttv-website" || health.environment !== "staging" || health.version !== expectedVersion || health.checks?.db !== "ok") throw new Error("Deployment mismatch");
    const target = Object.freeze({
      baseUrl: url.origin,
      expectedVersion,
      database: Object.freeze({ uuid: database.uuid, name: database.name }),
      async executeQuery(sql, params = []) {
        try {
          return await api(`/d1/database/${STAGING_FIXTURE_DATABASE_ID}/query`, { method: "POST", body: { sql, params } });
        } catch {
          // API errors can contain SQL bindings, including fixture credentials.
          throw new Error("Staging fixture database operation failed.");
        }
      },
    });
    targets.add(target);
    return target;
  } catch {
    throw new Error("Staging fixture identity preflight failed; no fixture writes performed.");
  }
}

export function assertVerifiedStagingFixtureTarget(target) {
  if (!targets.has(target)) throw new Error("A verified staging fixture target is required.");
}
