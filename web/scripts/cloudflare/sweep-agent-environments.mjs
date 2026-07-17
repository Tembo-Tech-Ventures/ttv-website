import path from "node:path";
import { fileURLToPath } from "node:url";
import { destroyEnvironment } from "./destroy.mjs";
import {
  cfApi,
  deriveEnvironmentContext,
  getOptionalEnv,
  normalizeSlug,
} from "./lib.mjs";

const DEFAULT_MAX_AGE_HOURS = 72;
const MINIMUM_MAX_AGE_HOURS = 6;

export function parseSweepArgs(args) {
  const options = {
    execute: false,
    maxAgeHours: DEFAULT_MAX_AGE_HOURS,
    excludedEnvironments: [],
  };

  for (const arg of args) {
    if (arg === "--execute") options.execute = true;
    if (arg.startsWith("--max-age-hours=")) {
      options.maxAgeHours = Number(arg.split("=")[1]);
    }
    if (arg.startsWith("--exclude=")) {
      options.excludedEnvironments = arg
        .split("=")
        .slice(1)
        .join("=")
        .split(",")
        .map((entry) => entry.trim())
        .filter(Boolean)
        .map(normalizeSlug);
    }
  }

  if (
    !Number.isFinite(options.maxAgeHours) ||
    options.maxAgeHours < MINIMUM_MAX_AGE_HOURS
  ) {
    throw new Error(`--max-age-hours must be at least ${MINIMUM_MAX_AGE_HOURS}.`);
  }
  return options;
}

export function findStaleAgentEnvironments({
  workers = [],
  databases = [],
  appName = "ttv-website",
  now = new Date(),
  maxAgeHours = DEFAULT_MAX_AGE_HOURS,
  excludedEnvironments = [],
}) {
  const appSlug = normalizeSlug(appName);
  const workerPrefix = `${appSlug}-agent-`;
  const environmentPrefix = `${appSlug}-`;
  const databasePrefix = `${appSlug}-db-agent-`;
  const databaseEnvironmentPrefix = `${appSlug}-db-`;
  const excluded = new Set(excludedEnvironments.map(normalizeSlug));
  const cutoff = now.getTime() - maxAgeHours * 60 * 60 * 1_000;
  const inventory = new Map();

  function record({ environmentName, timestamp, workerName, databaseName }) {
    if (
      !environmentName.startsWith("agent-") ||
      excluded.has(environmentName) ||
      !timestamp
    ) {
      return;
    }
    const observedAt = new Date(timestamp);
    if (Number.isNaN(observedAt.getTime())) return;

    const existing = inventory.get(environmentName);
    inventory.set(environmentName, {
      environmentName,
      observedAt:
        existing && existing.observedAt > observedAt ? existing.observedAt : observedAt,
      workerName: workerName ?? existing?.workerName,
      databaseName: databaseName ?? existing?.databaseName,
    });
  }

  for (const worker of workers) {
    const workerName = String(worker.id ?? worker.name ?? "");
    if (!workerName.startsWith(workerPrefix)) continue;
    record({
      environmentName: workerName.slice(environmentPrefix.length),
      workerName,
      timestamp: worker.modified_on ?? worker.created_on,
    });
  }

  for (const database of databases) {
    const databaseName = String(database.name ?? "");
    if (!databaseName.startsWith(databasePrefix)) continue;
    record({
      environmentName: databaseName.slice(databaseEnvironmentPrefix.length),
      databaseName,
      timestamp: database.created_at,
    });
  }

  return [...inventory.values()]
    .filter(({ observedAt }) => observedAt.getTime() <= cutoff)
    .map(({ observedAt, ...candidate }) => ({
      ...candidate,
      lastModified: observedAt.toISOString(),
      ageHours: Math.floor((now.getTime() - observedAt.getTime()) / (60 * 60 * 1_000)),
    }))
    .sort((left, right) => right.ageHours - left.ageHours);
}

async function listWorkers() {
  const result = await cfApi("/workers/scripts");
  return Array.isArray(result) ? result : [];
}

async function listDatabases() {
  const result = await cfApi("/d1/database?per_page=1000");
  return Array.isArray(result) ? result : [];
}

async function destroyByEnvironmentName(environmentName) {
  const previousName = process.env.CLOUDFLARE_ENVIRONMENT_NAME;
  process.env.CLOUDFLARE_ENVIRONMENT_NAME = environmentName;
  try {
    return await destroyEnvironment(deriveEnvironmentContext());
  } finally {
    if (previousName === undefined) {
      delete process.env.CLOUDFLARE_ENVIRONMENT_NAME;
    } else {
      process.env.CLOUDFLARE_ENVIRONMENT_NAME = previousName;
    }
  }
}

export async function sweepAgentEnvironments({
  execute = false,
  maxAgeHours = DEFAULT_MAX_AGE_HOURS,
  excludedEnvironments = [],
  now = new Date(),
  workers,
  databases,
  appName = getOptionalEnv("CLOUDFLARE_APP_NAME") ?? "ttv-website",
  destroy = destroyByEnvironmentName,
} = {}) {
  let availableWorkers = workers ?? [];
  let availableDatabases = databases ?? [];
  if (workers === undefined && databases === undefined) {
    [availableWorkers, availableDatabases] = await Promise.all([
      listWorkers(),
      listDatabases(),
    ]);
  }

  const candidates = findStaleAgentEnvironments({
    workers: availableWorkers,
    databases: availableDatabases,
    appName,
    now,
    maxAgeHours,
    excludedEnvironments,
  });

  if (!execute) {
    return {
      mode: "dry-run",
      maxAgeHours,
      candidates,
    };
  }

  const results = [];
  for (const candidate of candidates) {
    try {
      const deleted = await destroy(candidate.environmentName);
      results.push({ ...candidate, status: "destroyed", deleted });
    } catch (error) {
      results.push({
        ...candidate,
        status: "blocked",
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return {
    mode: "execute",
    maxAgeHours,
    candidates,
    results,
  };
}

async function main() {
  const result = await sweepAgentEnvironments(parseSweepArgs(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
  if (result.results?.some(({ status }) => status === "blocked")) {
    process.exitCode = 1;
  }
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
