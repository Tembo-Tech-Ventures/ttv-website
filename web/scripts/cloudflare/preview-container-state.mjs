import { pathToFileURL } from 'node:url';

const applicationName = 'ttv-website-agent-pr-220-ffmpegcontainer';
const states = new Set(['provisioning', 'running', 'failed', 'stopping', 'stopped', 'unhealthy', 'inactive', 'unknown']);
const branch = 'sam/use-sam-mcp-tools-m8a3jp';

/** One bounded metadata read. Never calls the Worker or starts/stops a container. */
export async function inspectPreviewContainer({ env = process.env, fetchImpl = fetch } = {}) {
  const report = { event: 'preview-container-state', target: 'agent-pr-220', observedAt: new Date().toISOString() };
  const gap = reason => ({ ...report, outcome: 'telemetry-gap', reason });
  if (env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || env.GITHUB_RUN_ATTEMPT !== '1' ||
      env.GITHUB_REF !== `refs/heads/${branch}` || env.STAGING_ACTION !== 'preview-container-state' ||
      !/^[a-f0-9]{40}$/.test(env.STAGING_EXPECTED_SHA ?? '') || env.GITHUB_SHA !== env.STAGING_EXPECTED_SHA) {
    return gap('invalid-dispatch');
  }
  if (!/^[a-f0-9]{32}$/.test(env.CLOUDFLARE_ACCOUNT_ID ?? '') || !env.CLOUDFLARE_API_TOKEN) return gap('credentials-unavailable');
  const base = `https://api.cloudflare.com/client/v4/accounts/${env.CLOUDFLARE_ACCOUNT_ID}/containers/applications`;
  async function read(url) {
    const response = await fetchImpl(url, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
    });
    if (!response.ok) throw new Error(`http-${response.status}`);
    const data = await response.json();
    if (data.success === false || !Array.isArray(data.result)) throw new Error('invalid-response');
    return data;
  }
  try {
    const apps = await read(`${base}?name=${encodeURIComponent(applicationName)}&per_page=2`);
    if (apps.result_info?.next_page_token || apps.result.length !== 1 || apps.result[0].name !== applicationName ||
        !/^[a-f0-9-]{32,36}$/.test(apps.result[0].id ?? '')) return gap('exact-application-not-resolved');
    const instances = await read(`${base}/${apps.result[0].id}/instances-v2?per_page=1000`);
    if (instances.result_info?.next_page_token || instances.result.length >= 1000) return gap('incomplete-instance-list');
    const counts = {};
    const observations = [];
    for (const instance of instances.result) {
      const state = instance.status?.state;
      const updated = instance.status?.updated_at;
      if (instance.application_id !== apps.result[0].id || !states.has(state) ||
          typeof updated !== 'string' || !Number.isFinite(Date.parse(updated))) return gap('invalid-instance-state');
      counts[state] = (counts[state] ?? 0) + 1;
      observations.push({ state, updatedAt: new Date(updated).toISOString() });
    }
    // API observations are not proof that an earlier finally/destroy call completed.
    return { ...report, outcome: 'observed', count: observations.length, counts, observations };
  } catch (error) {
    const reason = /^http-\d{3}$/.test(error?.message ?? '') ? error.message : 'request-or-response-failed';
    return gap(reason);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await inspectPreviewContainer();
  console.log(JSON.stringify(report));
  if (report.outcome !== 'observed') process.exitCode = 1;
}
