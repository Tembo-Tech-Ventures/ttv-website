import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const webRoot = path.resolve(__dirname, "..", "..");
const generatedDir = path.join(webRoot, "dist", "server");

const DEFAULT_APP_NAME = "ttv-website";
const DEFAULT_COMPATIBILITY_DATE = "2026-04-01";
const SECRET_KEYS = ["GITHUB_CLIENT_ID", "GITHUB_CLIENT_SECRET"];

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

function deriveBetterAuthSecret() {
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

  return {
    appName,
    environmentName,
    environmentSlug,
    workerName: joinName([appName, environmentSlug]),
    d1Name: joinName([appName, "db", environmentSlug]),
    bucketName: joinName([appName, "files", environmentSlug]),
  };
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
      body: body ? JSON.stringify(body) : undefined,
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

export async function deleteR2BucketByName(name) {
  const existing = await cfApi(`/r2/buckets/${encodeURIComponent(name)}`);
  if (!existing) {
    return false;
  }

  await cfApi(`/r2/buckets/${encodeURIComponent(name)}`, { method: "DELETE" });
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

export async function enableWorkersDevSubdomain(workerName) {
  await cfApi(`/workers/scripts/${encodeURIComponent(workerName)}/subdomain`, {
    method: "POST",
  });
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

export async function writeGeneratedWranglerConfig({
  workerName,
  d1Name,
  d1Id,
  bucketName,
  primaryDomain,
  redirectDomain,
  betterAuthUrl,
}) {
  const migrationsDir = path.relative(
    generatedDir,
    path.join(webRoot, "src", "lib", "db", "migrations")
  );

  const config = {
    $schema: path.relative(
      generatedDir,
      path.join(webRoot, "node_modules", "wrangler", "config-schema.json")
    ),
    name: workerName,
    compatibility_date: DEFAULT_COMPATIBILITY_DATE,
    compatibility_flags: ["nodejs_compat"],
    main: "entry.mjs",
    no_bundle: true,
    workers_dev: true,
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
    vars: {
      BETTER_AUTH_URL: betterAuthUrl,
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

  const configPath = path.join(generatedDir, "wrangler.generated.json");
  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  return configPath;
}

export function getSecretBindings() {
  const bindings = SECRET_KEYS.map((key) => {
    const value = getRequiredEnv(key);
    return { key, value };
  });

  bindings.unshift({
    key: "BETTER_AUTH_SECRET",
    value: getOptionalEnv("BETTER_AUTH_SECRET") ?? deriveBetterAuthSecret(),
  });

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
