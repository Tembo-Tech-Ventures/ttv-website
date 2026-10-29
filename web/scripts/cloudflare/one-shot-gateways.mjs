import { pathToFileURL } from 'node:url';

export const approvedPrs = Object.freeze([208, 209, 210, 211, 212, 213, 214, 216, 218, 219, 220, 221]);

export function validateGateway(pr, gateway, state, now = Date.now()) {
  if (!approvedPrs.includes(pr) || gateway.id !== `ttv-website-ai-agent-pr-${pr}` || state !== 'closed') {
    throw new Error('Gateway is outside the approved closed-PR scope');
  }
  const dates = [gateway.created_at, gateway.modified_at].map(value => Date.parse(`${value.replace(' ', 'T').replace(/Z$/, '')}Z`));
  if (dates.some(value => !Number.isFinite(value) || now - value < 72 * 3600000)) {
    throw new Error('Gateway age cannot be verified as at least 72 hours');
  }
}

export async function reclaim({ execute = false, fetcher = fetch, environment = process.env } = {}) {
  const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token, GH_TOKEN: githubToken } = environment;
  if (!account || !token || !githubToken) throw new Error('Required broker credentials are absent');
  const base = `https://api.cloudflare.com/client/v4/accounts/${account}`;
  async function cf(path, method = 'GET') {
    const response = await fetcher(`${base}${path}`, { method, headers: { Authorization: `Bearer ${token}` } });
    const payload = await response.json();
    if (!response.ok || payload.success !== true) throw new Error(`Cloudflare ${method} failed (HTTP ${response.status})`);
    return payload;
  }
  async function state(pr) {
    const response = await fetcher(`https://api.github.com/repos/Tembo-Tech-Ventures/ttv-website/pulls/${pr}`, { headers: { Authorization: `Bearer ${githubToken}`, Accept: 'application/vnd.github+json' } });
    if (!response.ok) throw new Error(`PR state verification failed (HTTP ${response.status})`);
    return (await response.json()).state;
  }
  // Validate every candidate before the first mutation. No arbitrary names or storage operations.
  const candidates = [];
  for (const pr of approvedPrs) {
    const path = `/ai-gateway/gateways/ttv-website-ai-agent-pr-${pr}`;
    const gateway = (await cf(path)).result;
    validateGateway(pr, gateway, await state(pr));
    candidates.push({ pr, path, gateway });
  }
  const results = [];
  for (const { pr, path, gateway } of candidates) {
    if (execute) {
      validateGateway(pr, gateway, await state(pr));
      await cf(path, 'DELETE');
      const check = await fetcher(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
      if (check.status !== 404) throw new Error(`Gateway deletion could not be verified for PR ${pr}`);
    }
    results.push({ gateway: gateway.id, status: execute ? 'deleted-and-verified' : 'eligible' });
  }
  // Diagnose R2 using the same broker credential; print no keys or provider payloads.
  const r2 = await fetcher(`${base}/r2/buckets/ttv-website-files-agent-pr-208/objects?per_page=1000`, { headers: { Authorization: `Bearer ${token}` } });
  const payload = await r2.json();
  return { results, r2: { status: r2.status, success: payload.success, objectCount: Array.isArray(payload.result) ? payload.result.length : null, paginationFields: Object.keys(payload.result_info ?? {}), hasExplicitTruncation: typeof payload.result_info?.is_truncated === 'boolean' } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  reclaim({ execute: process.argv.includes('--execute') }).then(result => console.log(JSON.stringify(result, null, 2))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
