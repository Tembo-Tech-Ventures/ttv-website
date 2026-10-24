import { randomBytes } from "node:crypto";
import { cfApi, deleteR2BucketObject } from "./lib.mjs";
import { isAgentEnvironmentName } from "./agent-preview-auth.mjs";

const rows = result => (Array.isArray(result) ? result : [result]).flatMap(item => item?.results ?? []);

/** New identity per invocation, never a reused student's rate-limit counter. */
export async function withPreviewFeedbackWriter({ environment = process.env, run, api = cfApi, removeObject = deleteR2BucketObject, fetchImpl = fetch }) {
  const name = environment.EXPECTED_DEPLOYMENT_ENVIRONMENT;
  if (!isAgentEnvironmentName(name ?? "") || environment.CLOUDFLARE_ENVIRONMENT_NAME !== name ||
      (environment.CLOUDFLARE_APP_NAME ?? "ttv-website") !== "ttv-website" ||
      !/^[a-f0-9]{40}$/.test(environment.EXPECTED_DEPLOYMENT_VERSION ?? "")) throw new Error("Isolated feedback fixture target rejected.");
  const worker = `ttv-website-${name}`;
  const databaseName = `ttv-website-db-${name}`;
  const bucketName = `ttv-website-files-${name}`;
  let databaseId;
  try {
    const subdomain = await api("/workers/subdomain");
    const base = new URL(environment.PLAYWRIGHT_BASE_URL);
    if (base.username || base.password || base.origin !== `https://${worker}.${subdomain.subdomain}.workers.dev` || base.pathname !== "/" || base.search || base.hash) throw new Error("Origin mismatch");
    const settings = await api(`/workers/scripts/${worker}/settings`);
    const binding = key => settings?.bindings?.find(value => value.name === key);
    databaseId = binding("DB")?.id;
    if (binding("DB")?.type !== "d1" || !/^[a-f0-9-]{36}$/.test(databaseId ?? "") ||
        binding("BUCKET")?.type !== "r2_bucket" || binding("BUCKET")?.bucket_name !== bucketName ||
        binding("AGENT_AUTH_ENABLED")?.text !== "true" ||
        binding("DEPLOYMENT_ENVIRONMENT")?.text !== name ||
        binding("DEPLOYMENT_VERSION")?.text !== environment.EXPECTED_DEPLOYMENT_VERSION ||
        binding("BETTER_AUTH_URL")?.text !== base.origin) throw new Error("Binding mismatch");
    const database = await api(`/d1/database/${databaseId}`);
    if (database?.uuid !== databaseId || database?.name !== databaseName) throw new Error("Database mismatch");
    const response = await fetchImpl(new URL("/api/health", base), { redirect: "error", signal: globalThis.AbortSignal.timeout(15000) });
    const health = response.ok ? await response.json() : null;
    if (health?.service !== "ttv-website" || health?.environment !== name || health?.version !== environment.EXPECTED_DEPLOYMENT_VERSION || health?.checks?.db !== "ok") throw new Error("Health mismatch");
  } catch {
    throw new Error("Isolated feedback fixture preflight failed; no writes performed.");
  }
  const execute = async (sql, params = []) => {
    try { return await api(`/d1/database/${databaseId}/query`, { method: "POST", body: { sql, params } }); }
    catch { throw new Error("Isolated feedback fixture database operation failed."); }
  };
  const suffix = randomBytes(16).toString("hex");
  const userId = `ttv-feedback-run-${suffix}`;
  const sessionId = `${userId}-session`;
  const token = randomBytes(32).toString("hex");
  const now = Math.floor(Date.now() / 1000);
  // Cleanup errors fail the run; revoke access before deleting owned objects.
  const cleanup = async () => {
    await execute("DELETE FROM session WHERE userId=? AND id=?", [userId, sessionId]);
    const attachments = rows(await execute("SELECT a.objectKey, a.feedbackId FROM feedback_attachment a JOIN feedback f ON f.id=a.feedbackId WHERE f.userId=?", [userId]));
    // Validate all keys before any object deletion, not a bucket-wide list/reset.
    for (const attachment of attachments) {
      if (!/^[a-zA-Z0-9_-]+$/.test(attachment.feedbackId) || !attachment.objectKey?.startsWith(`feedback/${attachment.feedbackId}/`) || attachment.objectKey.includes("..")) {
        throw new Error("Isolated feedback attachment ownership rejected; rows retained.");
      }
    }
    try {
      for (const attachment of attachments) await removeObject(bucketName, attachment.objectKey);
    } catch { throw new Error("Isolated feedback attachment cleanup failed; rows retained."); }
    await execute('DELETE FROM "user" WHERE id=? AND email=?', [userId, `${userId}@invalid.ttv`]);
    const remaining = rows(await execute('SELECT id FROM "user" WHERE id=? UNION ALL SELECT id FROM session WHERE userId=? UNION ALL SELECT id FROM feedback WHERE userId=?', [userId, userId, userId]));
    if (remaining.length > 0) throw new Error("Isolated feedback fixture cleanup incomplete.");
  };
  try {
    await execute('INSERT INTO "user" (id,name,email,emailVerified,createdAt,updatedAt) VALUES (?,?,?,1,?,?)',
      [userId, "Fictional Amina Wanjiku", `${userId}@invalid.ttv`, now, now]);
    await execute('INSERT INTO session (id,userId,token,expiresAt,createdAt,updatedAt,userAgent) VALUES (?,?,?,?,?,?,?)',
      [sessionId, userId, token, now + 3600, now, now, "ttv-agent:isolated-feedback"]);
    return await run(token);

  } finally {
    await cleanup();
  }
}
