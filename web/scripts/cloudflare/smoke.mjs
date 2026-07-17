import path from "node:path";
import { fileURLToPath } from "node:url";

function normalizeBaseUrl(value) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Smoke base URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("Smoke base URL must not include credentials.");
  }
  return url.origin;
}

export function parseSmokeArgs(args) {
  const options = {};
  for (const arg of args) {
    const [name, ...valueParts] = arg.split("=");
    const value = valueParts.join("=").trim();
    if (name === "--base-url") options.baseUrl = value;
    if (name === "--expected-environment") options.expectedEnvironment = value;
    if (name === "--expected-version") options.expectedVersion = value;
  }

  if (!options.baseUrl) {
    throw new Error("Missing required --base-url=https://... argument.");
  }
  return options;
}

async function fetchChecked(fetchImpl, url, timeoutMs) {
  const response = await fetchImpl(url, {
    redirect: "follow",
    signal: globalThis.AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(`${url} returned HTTP ${response.status}.`);
  }
  return response;
}

function sleep(durationMs) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, durationMs));
}

function assertExpectedHealth(health, healthUrl, expectedEnvironment, expectedVersion) {
  if (health.status !== "ok" || health.service !== "ttv-website") {
    throw new Error(`${healthUrl} returned an unexpected health payload.`);
  }
  if (expectedEnvironment && health.environment !== expectedEnvironment) {
    throw new Error(
      `Expected environment "${expectedEnvironment}" but health reported "${health.environment}".`
    );
  }
  if (expectedVersion && health.version !== expectedVersion) {
    throw new Error(
      `Expected version "${expectedVersion}" but health reported "${health.version}".`
    );
  }
}

async function waitForExpectedHealth({
  fetchImpl,
  healthUrl,
  expectedEnvironment,
  expectedVersion,
  timeoutMs,
  healthAttempts,
  retryDelayMs,
  sleepImpl,
}) {
  let lastError;
  for (let attempt = 1; attempt <= healthAttempts; attempt += 1) {
    try {
      const response = await fetchChecked(fetchImpl, healthUrl, timeoutMs);
      const health = await response.json();
      assertExpectedHealth(health, healthUrl, expectedEnvironment, expectedVersion);
      return health;
    } catch (error) {
      lastError = error;
      if (attempt < healthAttempts) {
        await sleepImpl(retryDelayMs);
      }
    }
  }

  const reason = lastError instanceof Error ? lastError.message : String(lastError);
  throw new Error(
    `Deployment did not become ready after ${healthAttempts} attempts: ${reason}`
  );
}

export async function runSmokeChecks({
  baseUrl,
  expectedEnvironment,
  expectedVersion,
  fetchImpl = fetch,
  timeoutMs = 15_000,
  healthAttempts = 30,
  retryDelayMs = 2_000,
  sleepImpl = sleep,
}) {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl);
  const healthUrl = `${normalizedBaseUrl}/api/health`;
  const health = await waitForExpectedHealth({
    fetchImpl,
    healthUrl,
    expectedEnvironment,
    expectedVersion,
    timeoutMs,
    healthAttempts,
    retryDelayMs,
    sleepImpl,
  });

  const homepageResponse = await fetchChecked(
    fetchImpl,
    `${normalizedBaseUrl}/`,
    timeoutMs
  );
  const contentType = homepageResponse.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html")) {
    throw new Error(
      `${normalizedBaseUrl}/ returned unexpected content type "${contentType}".`
    );
  }

  return {
    baseUrl: normalizedBaseUrl,
    environment: health.environment,
    version: health.version,
    checks: ["health", "homepage"],
  };
}

async function main() {
  const result = await runSmokeChecks(parseSmokeArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
