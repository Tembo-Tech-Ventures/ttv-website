import { pathToFileURL } from "node:url";

const ACCOUNT = "c25be21f175bf10728876d8ca26a9619";
const PERMISSIONS = new Set(["AI Gateway Read", "AI Gateway Run", "AI Gateway Edit", "Workers AI Read", "Workers Scripts Read", "Workers Scripts Write", "Workers Scripts Edit", "Account API Tokens Read", "Account API Tokens Write", "API Tokens Read", "API Tokens Write", "API Tokens Edit"]);

/** Read-only metadata audit. Never return provider text, identifiers or credentials. */
export async function auditStagingCredential(env, { fetchImpl = fetch } = {}) {
  let stage = "configuration";
  let httpStatus = null;
  const report = { status: "failed", stage, httpStatus, tokenStatus: "unknown", permissions: [], otherPermissionCount: 0 };
  try {
    if (env.CLOUDFLARE_ENVIRONMENT_NAME !== "staging" || env.CLOUDFLARE_ACCOUNT_ID !== ACCOUNT || !env.CLOUDFLARE_API_TOKEN || !["user", "account"].includes(env.AUDIT_TOKEN_KIND)) throw new Error();
    const root = env.AUDIT_TOKEN_KIND === "user" ? "/user/tokens" : `/accounts/${ACCOUNT}/tokens`;
    async function read(path) {
      httpStatus = null;
      const response = await fetchImpl(`https://api.cloudflare.com/client/v4${path}`, {
        method: "GET", redirect: "error", signal: globalThis.AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` },
      });
      httpStatus = response.status;
      if (!response.ok) throw new Error();
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      let size = 0;
      const chunks = [];
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.byteLength;
          if (size > 64_000) { await reader.cancel(); throw new Error(); }
          chunks.push(value);
        }
      } finally { reader.releaseLock(); }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      const payload = JSON.parse(new globalThis.TextDecoder().decode(bytes));
      if (payload.success !== true) throw new Error();
      return payload.result;
    }
    stage = "verify";
    const verified = await read(`${root}/verify`);
    if (verified?.status !== "active" || !/^[a-f0-9]{32}$/.test(verified.id ?? "")) throw new Error();
    report.tokenStatus = "active";
    stage = "permissions";
    const details = await read(`${root}/${verified.id}`);
    if (details?.id !== verified.id || details.status !== "active" || !Array.isArray(details.policies)) throw new Error();
    // Permission names alone are not effective authorization: deny/resource policies still apply.
    const names = new Set();
    let otherPermissionCount = 0;
    for (const policy of details.policies) {
      if (!["allow", "deny"].includes(policy.effect) || !Array.isArray(policy.permission_groups)) throw new Error();
      for (const group of policy.permission_groups) {
        if (typeof group?.name !== "string") throw new Error();
        if (PERMISSIONS.has(group.name)) names.add(`${policy.effect}:${group.name}`);
        else otherPermissionCount++;
      }
    }
    return { ...report, status: "completed", stage, httpStatus, permissions: [...names].toSorted(), otherPermissionCount };
  } catch {
    return { ...report, stage, httpStatus };
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await auditStagingCredential(process.env);
  console.log(JSON.stringify(report));
  if (report.status !== "completed") process.exitCode = 1;
}
