import { pathToFileURL } from "node:url";
import { validateStagingRevision } from "./staging-preflight.mjs";

const ACCOUNT = "c25be21f175bf10728876d8ca26a9619";
const ROOT = `/accounts/${ACCOUNT}`;
const SECRET_PATH = `${ROOT}/workers/scripts/ttv-website-staging/secrets`;
const SECRET = "AI_GATEWAY_API_KEY";
const NAME = "ttv-staging-inference-hackathon-2026-10";
const EXPIRES = "2026-10-26T00:00:00Z";
const SCOPE = "com.cloudflare.api.account";
const ID = /^[a-f0-9]{32}$/;

/** One-shot, staging-only setup. Provider bodies and credential values never leave this function. */
export async function setupStagingGateway(env, { fetchImpl = fetch, validateRevision = validateStagingRevision, now = Date.now } = {}) {
  const report = { status: "failed", stage: "configuration", httpStatus: null, creation: "not-attempted", tokenId: null, binding: "not-written", rollback: "not-needed" };
  let bootstrapId;
  let createdId;
  let putAttempted = false;
  async function request(method, path, body) {
    report.httpStatus = null;
    const response = await fetchImpl(`https://api.cloudflare.com/client/v4${path}`, {
      method, redirect: "error", signal: globalThis.AbortSignal.timeout(15_000),
      headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    report.httpStatus = response.status;
    if (!response.ok) throw new Error(); // Never inspect provider error bodies.
    const reader = response.body?.getReader();
    if (!reader) throw new Error();
    let size = 0;
    const chunks = [];
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 256_000) { await reader.cancel(); throw new Error(); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const payload = JSON.parse(new globalThis.TextDecoder().decode(bytes));
    if (payload.success !== true) throw new Error();
    return payload;
  }
  async function secretPresent() {
    const { result } = await request("GET", SECRET_PATH);
    if (!Array.isArray(result) || result.some(item => typeof item?.name !== "string")) throw new Error();
    return result.some(item => item.name === SECRET);
  }
  try {
    if (env.CLOUDFLARE_ENVIRONMENT_NAME !== "staging" || env.CLOUDFLARE_ACCOUNT_ID !== ACCOUNT ||
        !env.CLOUDFLARE_API_TOKEN || env.GITHUB_RUN_ATTEMPT !== "1" ||
        env.GITHUB_REPOSITORY?.toLowerCase() !== "tembo-tech-ventures/ttv-website" ||
        env.STAGING_INTEGRATION_BRANCH !== "sam/use-sam-mcp-tools-m8a3jp" || env.STAGING_INTEGRATION_PR !== "171" ||
        now() >= Date.parse(EXPIRES)) throw new Error();
    report.stage = "revision";
    await validateRevision(env);
    report.stage = "existing-binding";
    if (await secretPresent()) { report.binding = "already-present"; throw new Error(); }
    report.stage = "bootstrap";
    const { result: bootstrap } = await request("GET", `${ROOT}/tokens/verify`);
    if (bootstrap?.status !== "active" || !ID.test(bootstrap.id ?? "")) throw new Error();
    bootstrapId = bootstrap.id;
    // Prevent a new dispatch from duplicating a prior ambiguous creation. Never delete inventory tokens.
    report.stage = "existing-token";
    let complete = false;
    for (let page = 1; page <= 20; page++) {
      const payload = await request("GET", `${ROOT}/tokens?page=${page}&per_page=50&include_expired=true`);
      const { result, result_info: info } = payload;
      if (!Array.isArray(result) || result.some(token => typeof token?.name !== "string") ||
          info?.page !== page || !Number.isSafeInteger(info.total_count) || info.total_count < 0 ||
          info.per_page !== 50 ||
          result.length !== Math.min(50, Math.max(0, info.total_count - (page - 1) * 50))) throw new Error();
      if (result.some(token => token.name === NAME)) throw new Error();
      if (page * 50 >= info.total_count) { complete = true; break; }
    }
    if (!complete) throw new Error();
    report.stage = "permissions";
    const groups = [];
    for (const name of ["AI Gateway Run", "Workers AI Read"]) {
      const { result } = await request("GET", `${ROOT}/tokens/permission_groups?name=${encodeURIComponent(name)}&scope=${SCOPE}`);
      if (!Array.isArray(result)) throw new Error();
      const matches = result.filter(group => group.name === name);
      if (matches.length !== 1 || !ID.test(matches[0].id ?? "") || matches[0].is_selectable !== true ||
          !matches[0].scopes?.includes(SCOPE)) throw new Error();
      groups.push({ id: matches[0].id });
    }
    if (groups[0].id === groups[1].id) throw new Error();
    // Recheck the mutable PR immediately before creation; denial never causes a different endpoint retry.
    report.stage = "revision";
    await validateRevision(env);
    report.stage = "create";
    report.creation = "unknown";
    const { result: created } = await request("POST", `${ROOT}/tokens`, {
      name: NAME, expires_on: EXPIRES,
      policies: [{ effect: "allow", permission_groups: groups, resources: { [`${SCOPE}.${ACCOUNT}`]: "*" } }],
    });
    if (!ID.test(created?.id ?? "") || created.id === bootstrapId) throw new Error();
    createdId = created.id;
    report.tokenId = createdId; // Non-secret identifier, needed for manual reconciliation if rollback fails.
    report.creation = "created";
    if (typeof created.value !== "string" || !created.value || created.value === env.CLOUDFLARE_API_TOKEN) throw new Error();
    report.stage = "token-policy";
    const { result: details } = await request("GET", `${ROOT}/tokens/${createdId}`);
    const policy = details?.policies?.[0];
    if (details?.id !== createdId || details.status !== "active" || details.policies?.length !== 1 ||
        policy.effect !== "allow" || policy.permission_groups?.length !== 2 ||
        !groups.every(group => policy.permission_groups.some(actual => actual.id === group.id)) ||
        Object.keys(policy.resources ?? {}).length !== 1 || policy.resources[`${SCOPE}.${ACCOUNT}`] !== "*" ||
        Date.parse(details.expires_on) !== Date.parse(EXPIRES)) throw new Error();
    report.stage = "binding-recheck";
    if (await secretPresent()) throw new Error();
    report.stage = "write-binding";
    putAttempted = true;
    report.binding = "unknown";
    await request("PUT", SECRET_PATH, { name: SECRET, type: "secret_text", text: created.value });
    created.value = undefined;
    report.stage = "verify-binding";
    if (!await secretPresent()) throw new Error();
    report.binding = "present";
    report.status = "completed";
    return report;
  } catch {
    if (createdId) {
      const failedStage = report.stage;
      const failedStatus = report.httpStatus;
      report.rollback = "unknown";
      try {
        const { result } = await request("DELETE", `${ROOT}/tokens/${createdId}`);
        if (result?.id !== createdId) throw new Error();
        report.rollback = "revoked";
      } catch { /* No raw errors; never retry deletion or creation automatically. */ }
      report.stage = failedStage;
      report.httpStatus = failedStatus;
      if (putAttempted) report.binding = "may-contain-revoked-or-unusable-token";
    }
    return report;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await setupStagingGateway(process.env);
  console.log(JSON.stringify(report));
  if (report.status !== "completed") process.exitCode = 1;
}
