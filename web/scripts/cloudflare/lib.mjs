import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  assertAgentEnvironmentName,
  deriveAgentPreviewAuthSecret,
  deriveAgentPreviewCredentialKey,
  isAgentEnvironmentName,
} from "./agent-preview-auth.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const webRoot = path.resolve(__dirname, "..", "..");
const generatedDir = path.join(webRoot, "dist", "server");

const DEFAULT_APP_NAME = "ttv-website";
const DEFAULT_COMPATIBILITY_DATE = "2026-04-01";
const DEFAULT_AI_GATEWAY_MODEL = "workers-ai/@cf/openai/gpt-oss-20b";
const CONTAINER_CLASS_NAME = "FfmpegContainer";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getRequiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }

  return value;
}

export function getOptionalEnv(name) {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function deriveLegacyBetterAuthSecret() {
  const seed = [
    getRequiredEnv("CLOUDFLARE_ACCOUNT_ID"),
    getRequiredEnv("CLOUDFLARE_API_TOKEN"),
    getRequiredEnv("CLOUDFLARE_ENVIRONMENT_NAME"),
    getRequiredEnv("GITHUB_CLIENT_SECRET"),
    getOptionalEnv("CLOUDFLARE_APP_NAME") ?? DEFAULT_APP_NAME,
  ].join(":");

  return createHash("sha256").update(seed).digest("hex");
}

export function normalizeSlug(value) {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");

  if (!slug) {
    throw new Error(`Unable to derive a valid slug from "${value}"`);
  }

  return slug;
}

function joinName(parts, maxLength = 63) {
  const value = parts.filter(Boolean).join("-");
  return value.length <= maxLength ? value : value.slice(0, maxLength);
}

export function deriveEnvironmentContext() {
  const appName = normalizeSlug(
    getOptionalEnv("CLOUDFLARE_APP_NAME") ?? DEFAULT_APP_NAME
  );
  const environmentName = getRequiredEnv("CLOUDFLARE_ENVIRONMENT_NAME");
  const environmentSlug = normalizeSlug(environmentName);

  const workerName = joinName([appName, environmentSlug]);

  return {
    appName,
    environmentName,
    environmentSlug,
    workerName,
    containerAppName: joinName([workerName, CONTAINER_CLASS_NAME.toLowerCase()]),
    d1Name: joinName([appName, "db", environmentSlug]),
    bucketName: joinName([appName, "files", environmentSlug]),
    queueName: joinName([appName, "recording-pipeline", environmentSlug]),
    vectorizeIndexName: joinName([appName, "transcripts", environmentSlug]),
    aiGatewayName: joinName([appName, "ai", environmentSlug]),
  };
}

export function deriveAgentEnvironmentName(environment = process.env) {
  const explicitName = environment.CLOUDFLARE_ENVIRONMENT_NAME?.trim();
  if (explicitName) {
    const normalized = normalizeSlug(explicitName);
    return assertAgentEnvironmentName(normalized);
  }

  const workspaceIdentity =
    environment.SAM_TASK_ID?.trim() || environment.SAM_WORKSPACE_ID?.trim();
  if (!workspaceIdentity) {
    throw new Error(
      "Unable to derive an agent environment. Set SAM_TASK_ID, SAM_WORKSPACE_ID, or an agent-prefixed CLOUDFLARE_ENVIRONMENT_NAME."
    );
  }

  return assertAgentEnvironmentName(
    `agent-${normalizeSlug(workspaceIdentity).slice(-12)}`
  );
}

export function resolveDeploymentMetadata(environment = process.env) {
  return {
    environment: getRequiredEnvFrom(environment, "CLOUDFLARE_ENVIRONMENT_NAME"),
    version:
      environment.CLOUDFLARE_DEPLOYMENT_VERSION?.trim() ||
      environment.GITHUB_SHA?.trim() ||
      environment.SAM_TASK_ID?.trim() ||
      "unknown",
  };
}

function getRequiredEnvFrom(environment, name) {
  const value = environment[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export async function cfApi(resourcePath, { method = "GET", body } = {}) {
  const accountId = getRequiredEnv("CLOUDFLARE_ACCOUNT_ID");
  const token = getRequiredEnv("CLOUDFLARE_API_TOKEN");
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${accountId}${resourcePath}`,
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    }
  );

  if (response.status === 404) {
    return null;
  }

  if (response.status === 204) {
    return {};
  }

  const rawText = await response.text();
  const payload = rawText ? JSON.parse(rawText) : {};
  if (!response.ok || payload.success === false) {
    const details =
      payload?.errors?.map((entry) => entry.message).join("; ") ||
      response.statusText;
    throw new Error(`${method} ${resourcePath} failed: ${details}`);
  }

  return payload.result;
}

export async function ensureD1Database(name) {
  const jurisdiction = getOptionalEnv("CLOUDFLARE_D1_JURISDICTION");
  const existing = await cfApi(
    `/d1/database?name=${encodeURIComponent(name)}&per_page=10`
  );
  const found = Array.isArray(existing)
    ? existing.find((database) => database.name === name)
    : undefined;

  if (found) {
    return found;
  }

  return cfApi("/d1/database", {
    method: "POST",
    body: {
      name,
      ...(jurisdiction ? { jurisdiction } : {}),
    },
  });
}

export async function findD1DatabaseByName(name) {
  const existing = await cfApi(
    `/d1/database?name=${encodeURIComponent(name)}&per_page=10`
  );
  return Array.isArray(existing)
    ? existing.find((database) => database.name === name) ?? null
    : null;
}

export async function queryD1Database(databaseId, sql, params = []) {
  return cfApi(`/d1/database/${encodeURIComponent(databaseId)}/query`, {
    method: "POST",
    body: { sql, params },
  });
}

export async function deleteD1DatabaseByName(name) {
  const existing = await cfApi(
    `/d1/database?name=${encodeURIComponent(name)}&per_page=10`
  );
  const found = Array.isArray(existing)
    ? existing.find((database) => database.name === name)
    : undefined;

  if (!found) {
    return false;
  }

  await cfApi(`/d1/database/${found.uuid}`, { method: "DELETE" });
  return true;
}

export async function ensureR2Bucket(name) {
  const existing = await cfApi(`/r2/buckets/${encodeURIComponent(name)}`);
  if (existing) {
    return existing;
  }

  const jurisdiction = getOptionalEnv("CLOUDFLARE_R2_JURISDICTION");
  const locationHint = getOptionalEnv("CLOUDFLARE_R2_LOCATION_HINT");

  return cfApi("/r2/buckets", {
    method: "POST",
    body: {
      name,
      ...(locationHint ? { locationHint } : {}),
      ...(jurisdiction ? { jurisdiction } : {}),
    },
  });
}

export async function ensureQueue(name) {
  try {
    const existing = await runWrangler(["queues", "info", name]);
    if (existing) return true;
  } catch {
    // Wrangler exits non-zero when the queue does not exist.
  }

  await runWrangler(["queues", "create", name]);
  return true;
}

export async function ensureVectorizeIndex(name) {
  try {
    const existing = await runWrangler(["vectorize", "get", name]);
    if (existing) return true;
  } catch {
    // Wrangler exits non-zero when the index does not exist.
  }

  await runWrangler([
    "vectorize",
    "create",
    name,
    "--dimensions",
    "1024",
    "--metric",
    "cosine",
  ]);
  return true;
}

export async function ensureAiGateway(name) {
  const existing = await cfApi(
    `/ai-gateway/gateways/${encodeURIComponent(name)}`
  );
  if (existing) {
    return existing;
  }

  return cfApi("/ai-gateway/gateways", {
    method: "POST",
    body: {
      id: name,
      collect_logs: true,
      cache_invalidate_on_update: false,
      cache_ttl: 0,
      rate_limiting_interval: 0,
      rate_limiting_limit: 0,
      rate_limiting_technique: "fixed",
    },
  });
}

export async function deleteAiGatewayByName(name) {
  const deleted = await cfApi(
    `/ai-gateway/gateways/${encodeURIComponent(name)}`,
    { method: "DELETE" }
  );
  return deleted !== null;
}

function isMissingResourceError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return /not found|does not exist|could not find/i.test(message);
}

export async function removeQueueWorkerConsumer(
  queueName,
  workerName,
  runner = runWrangler
) {
  try {
    await runner([
      "queues",
      "consumer",
      "worker",
      "remove",
      queueName,
      workerName,
    ]);
    return true;
  } catch (error) {
    if (isMissingResourceError(error)) return false;
    const message = error instanceof Error ? error.message : String(error);
    if (/No worker consumer '.+' exists for queue\b/.test(message)) return false;
    throw error;
  }
}

export async function deleteQueueByName(name, runner = runWrangler) {
  try {
    await runner(["queues", "info", name]);
  } catch (error) {
    if (isMissingResourceError(error)) return false;
    throw error;
  }

  await runner(["queues", "delete", name]);
  return true;
}

export async function deleteVectorizeIndexByName(name, runner = runWrangler) {
  try {
    await runner(["vectorize", "get", name]);
  } catch (error) {
    if (isMissingResourceError(error)) return false;
    throw error;
  }

  await runner(["vectorize", "delete", name, "--force"]);
  return true;
}

export async function deleteR2BucketByName(name) {
  const existing = await cfApi(`/r2/buckets/${encodeURIComponent(name)}`);
  if (!existing) {
    return false;
  }

  await cfApi(`/r2/buckets/${encodeURIComponent(name)}`, { method: "DELETE" });
  return true;
}

export async function deleteContainerAppByName(name, runner = runWrangler) {
  let listResult;
  try {
    listResult = await runner(["containers", "list", "--json"]);
  } catch (error) {
    if (isMissingResourceError(error)) return false;
    throw error;
  }

  let containers;
  try {
    containers = JSON.parse(listResult.stdout.trim());
  } catch {
    throw new Error("Failed to parse container list output as JSON");
  }

  if (!Array.isArray(containers)) {
    throw new TypeError(
      `Expected container list to be an array, got ${typeof containers}`
    );
  }

  const match = containers.find((entry) => entry.name === name);
  if (!match) {
    return false;
  }

  if (typeof match.id !== "string" || !UUID_PATTERN.test(match.id)) {
    throw new Error(
      `Container "${name}" has invalid id: ${JSON.stringify(match.id)}`
    );
  }

  await runner(["containers", "delete", match.id]);
  return true;
}

export async function ensureWorkersSubdomain() {
  const existing = await cfApi("/workers/subdomain");
  if (existing?.subdomain) {
    return existing.subdomain;
  }

  const requestedSubdomain = getOptionalEnv("CLOUDFLARE_WORKERS_SUBDOMAIN");
  if (!requestedSubdomain) {
    return undefined;
  }

  const created = await cfApi("/workers/subdomain", {
    method: "PUT",
    body: { subdomain: requestedSubdomain },
  });

  return created?.subdomain;
}

export async function deleteWorkerScript(workerName) {
  const deleted = await cfApi(
    `/workers/scripts/${encodeURIComponent(workerName)}?force=true`,
    { method: "DELETE" }
  );
  return deleted !== null;
}

function normalizeUrl(value) {
  if (!value) {
    return undefined;
  }

  return /^https?:\/\//.test(value) ? value : `https://${value}`;
}

export function resolveBetterAuthUrl({
  betterAuthUrl,
  primaryDomain,
  workerName,
  workersSubdomain,
}) {
  if (betterAuthUrl) {
    return normalizeUrl(betterAuthUrl);
  }

  if (primaryDomain) {
    return `https://${primaryDomain}`;
  }

  if (workersSubdomain) {
    return `https://${workerName}.${workersSubdomain}.workers.dev`;
  }

  throw new Error(
    "Unable to determine BETTER_AUTH_URL. Set CLOUDFLARE_PRIMARY_DOMAIN, CLOUDFLARE_BETTER_AUTH_URL, or CLOUDFLARE_WORKERS_SUBDOMAIN."
  );
}

export function createGeneratedWranglerConfig({
  workerName,
  containerAppName,
  d1Name,
  d1Id,
  bucketName,
  queueName,
  vectorizeIndexName,
  aiGatewayName,
  primaryDomain,
  redirectDomain,
  betterAuthUrl,
}) {
  const migrationsDir = path.relative(
    generatedDir,
    path.join(webRoot, "src", "lib", "db", "migrations")
  );

  const deployment = resolveDeploymentMetadata();
  const agentAuthEnabled =
    getOptionalEnv("CLOUDFLARE_AGENT_AUTH_ENABLED") === "true";
  const workersDevEnabled = !primaryDomain && !redirectDomain;
  if (
    agentAuthEnabled &&
    deployment.environment !== "staging" &&
    !deployment.environment.startsWith("agent-")
  ) {
    throw new Error(
      `Agent bearer auth is allowed only in staging or agent-* environments; received "${deployment.environment}".`
    );
  }
  const config = {
    $schema: path.relative(
      generatedDir,
      path.join(webRoot, "node_modules", "wrangler", "config-schema.json")
    ),
    name: workerName,
    compatibility_date: DEFAULT_COMPATIBILITY_DATE,
    compatibility_flags: ["nodejs_compat"],
    observability: {
      enabled: true,
      head_sampling_rate: deployment.environment.startsWith("agent-") ? 1 : 0.1,
    },
    main: "entry.mjs",
    no_bundle: true,
    workers_dev: workersDevEnabled,
    preview_urls: workersDevEnabled,
    rules: [
      {
        type: "ESModule",
        globs: ["**/*.js", "**/*.mjs"],
      },
    ],
    assets: {
      directory: "../client",
      binding: "ASSETS",
    },
    images: {
      binding: "IMAGES",
    },
    vars: {
      BETTER_AUTH_URL: betterAuthUrl,
      DEPLOYMENT_ENVIRONMENT: deployment.environment,
      DEPLOYMENT_VERSION: deployment.version,
      ...(agentAuthEnabled
        ? { AGENT_AUTH_ENABLED: "true" }
        : {}),
      AI_GATEWAY_ACCOUNT_ID: getRequiredEnv("CLOUDFLARE_ACCOUNT_ID"),
      AI_GATEWAY_NAME: aiGatewayName,
      AI_GATEWAY_MODEL:
        getOptionalEnv("CLOUDFLARE_AI_GATEWAY_MODEL") ??
        DEFAULT_AI_GATEWAY_MODEL,
      ...(primaryDomain ? { PRIMARY_DOMAIN: primaryDomain } : {}),
      ...(redirectDomain ? { REDIRECT_DOMAIN: redirectDomain } : {}),
    },
    d1_databases: [
      {
        binding: "DB",
        database_name: d1Name,
        database_id: d1Id,
        migrations_dir: migrationsDir,
      },
    ],
    r2_buckets: [
      {
        binding: "BUCKET",
        bucket_name: bucketName,
      },
    ],
    ai: {
      binding: "AI",
    },
    vectorize: [
      {
        binding: "VECTORIZE",
        index_name: vectorizeIndexName,
      },
    ],
    queues: {
      producers: [
        {
          binding: "RECORDING_QUEUE",
          queue: queueName,
        },
      ],
      consumers: [
        {
          queue: queueName,
          max_batch_size: 1,
          max_retries: 3,
        },
      ],
    },
    containers: [
      {
        name: containerAppName,
        class_name: CONTAINER_CLASS_NAME,
        image: path.relative(generatedDir, path.join(webRoot, "containers", "ffmpeg", "Dockerfile")),
        instance_type: "standard-2",
        max_instances: 3,
      },
    ],
    durable_objects: {
      bindings: [
        {
          name: "FFMPEG_CONTAINER",
          class_name: CONTAINER_CLASS_NAME,
        },
      ],
    },
    migrations: [
      {
        tag: "v1",
        new_sqlite_classes: [CONTAINER_CLASS_NAME],
      },
    ],
    ...(primaryDomain || redirectDomain
      ? {
          routes: [primaryDomain, redirectDomain]
            .filter(Boolean)
            .map((domain) => ({
              pattern: domain,
              custom_domain: true,
            })),
        }
      : {}),
  };

  return config;
}

export async function writeGeneratedWranglerConfig(options) {
  const configPath = path.join(generatedDir, "wrangler.generated.json");
  const config = createGeneratedWranglerConfig(options);
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return configPath;
}

export function getSecretBindings() {
  const environmentName = getRequiredEnv("CLOUDFLARE_ENVIRONMENT_NAME");
  const isAgentPreview = isAgentEnvironmentName(environmentName);
  const previewSecret = isAgentPreview
    ? getRequiredEnv("AGENT_PREVIEW_SECRET")
    : undefined;
  const bindings = [{
    key: "BETTER_AUTH_SECRET",
    value: isAgentPreview
      ? deriveAgentPreviewAuthSecret(previewSecret, environmentName)
      : getOptionalEnv("BETTER_AUTH_SECRET") ?? deriveLegacyBetterAuthSecret(),
  }, {
    key: "GITHUB_CLIENT_ID",
    value: isAgentPreview
      ? "agent-preview-oauth-disabled"
      : getRequiredEnv("GITHUB_CLIENT_ID"),
  }, {
    key: "GITHUB_CLIENT_SECRET",
    value: isAgentPreview
      ? "agent-preview-oauth-disabled"
      : getRequiredEnv("GITHUB_CLIENT_SECRET"),
  }];

  // Optional: scoped Workers AI token for AI Gateway unified-mode requests.
  // When absent, the worker falls back to the Workers AI binding.
  const aiGatewayToken = getOptionalEnv("CLOUDFLARE_AI_GATEWAY_TOKEN");
  if (aiGatewayToken) {
    bindings.push({ key: "AI_GATEWAY_API_KEY", value: aiGatewayToken });
  }

  const credentialKey = isAgentPreview
    ? deriveAgentPreviewCredentialKey(previewSecret, environmentName)
    : getOptionalEnv("CREDENTIALS_ENCRYPTION_KEY");
  if (credentialKey) {
    bindings.push({ key: "CREDENTIALS_ENCRYPTION_KEY", value: credentialKey });
  }

  return bindings;
}

export async function runWrangler(args, { input } = {}) {
  return runCommand(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["wrangler", ...args],
    { input }
  );
}

export async function runNpm(args, { input } = {}) {
  return runCommand(
    process.platform === "win32" ? "npm.cmd" : "npm",
    args,
    { input }
  );
}

export async function runGit(args, { input } = {}) {
  return runCommand(
    process.platform === "win32" ? "git.exe" : "git",
    args,
    { input }
  );
}

async function runCommand(binary, args, { input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, {
      cwd: webRoot,
      env: process.env,
      stdio: "pipe",
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      process.stdout.write(text);
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      process.stderr.write(text);
    });

    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }

      reject(
        new Error(
          `${binary} ${args.join(" ")} failed with exit code ${code}\n${stderr || stdout}`
        )
      );
    });

    if (input) {
      child.stdin.write(input);
    }

    child.stdin.end();
  });
}

export async function setWorkerSecrets(configPath, bindings) {
  for (const binding of bindings) {
    await runWrangler(["secret", "put", binding.key, "--config", configPath], {
      input: `${binding.value}\n`,
    });
  }
}

export function writeGithubOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) {
    return;
  }

  const line = `${name}=${value}\n`;
  return writeFile(outputPath, line, { flag: "a" });
}
