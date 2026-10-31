/**
 * Gateway-only reclaim (owner standing order, 2026-10-31): delete the AI
 * Gateways of closed PR previews, which PR-close teardown leaves behind when
 * it stops at the R2 guard. Touches nothing but gateways named
 * ttv-website-ai-agent-pr-<n> whose PR is confirmed closed; every other
 * gateway (open PRs, direct agent previews, staging, production) is kept.
 * Dry run unless RECLAIM_EXECUTE=true.
 */
const token = process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const github = process.env.GH_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
const execute = process.env.RECLAIM_EXECUTE === "true";
const split = (value) => new Set((value ?? "").split(",").map((entry) => entry.trim()).filter(Boolean));
const openEnvironments = split(process.env.OPEN_PR_EXCLUSIONS);
const keep = split(process.env.RECLAIM_KEEP);
const PATTERN = /^ttv-website-ai-(agent-pr-(\d+))$/;

if (!token || !account || !github || !repo) throw new Error("Missing Cloudflare or GitHub credentials.");

async function cf(path, init = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${account}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const body = await response.json();
  if (!body.success) throw new Error(`${init.method ?? "GET"} ${path}: ${JSON.stringify(body.errors)}`);
  return body;
}

async function prState(number) {
  const response = await fetch(`https://api.github.com/repos/${repo}/pulls/${number}`, {
    headers: { Authorization: `Bearer ${github}`, Accept: "application/vnd.github+json" },
  });
  if (!response.ok) return `unknown (${response.status})`;
  return (await response.json()).state;
}

const gateways = [];
for (let page = 1; page <= 50; page += 1) {
  const body = await cf(`/ai-gateway/gateways?per_page=50&page=${page}`);
  gateways.push(...body.result);
  if (body.result.length < 50) break;
}
console.log(`Gateways in account: ${gateways.length}`);

const reclaim = [];
for (const gateway of gateways.toSorted((a, b) => a.id.localeCompare(b.id))) {
  const match = PATTERN.exec(gateway.id);
  if (!match) {
    console.log(`keep   ${gateway.id}: not a PR preview gateway`);
    continue;
  }
  const [, environment, number] = match;
  if (openEnvironments.has(environment) || keep.has(environment)) {
    console.log(`keep   ${gateway.id}: open PR or explicitly kept`);
    continue;
  }
  const state = await prState(number);
  if (state !== "closed") {
    console.log(`keep   ${gateway.id}: PR #${number} state is ${state}`);
    continue;
  }
  console.log(`delete ${gateway.id}: PR #${number} is closed`);
  reclaim.push(gateway.id);
}

console.log(`${execute ? "Deleting" : "Would delete"} ${reclaim.length} gateway(s).`);
if (execute) {
  for (const id of reclaim) {
    await cf(`/ai-gateway/gateways/${encodeURIComponent(id)}`, { method: "DELETE" });
    console.log(`deleted ${id}`);
  }
}
