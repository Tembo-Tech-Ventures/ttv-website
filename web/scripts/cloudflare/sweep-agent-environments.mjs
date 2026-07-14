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
        .map((entry) => normalizeSlug(entry.trim()))
        .filter(Boolean);
    }
  }

  if (
    !Number.isFinite(options.maxAgeHours) ||
    options.maxAgeHours < MINIMUM_MAX_AGE_HOURS
  ) {
    throw new Error(
      `--max-age-hours must be at least ${MINIMUM_MAX_AGE_HOURS}.`
    );
  }
  return options;
}

export function findStaleAgentEnvironments({
  workers,
  appName = "ttv-website",
  now = new Date(),
  maxAgeHours = DEFAULT_MAX_AGE_HOURS,
  excludedEnvironments = [],
}) {
  const appSlug = normalizeSlug(appName);
  const workerPrefix = `${appSlug}-agent-`;
  const environmentPrefix = `${appSlug}-`;
  const excluded = new Set(excludedEnvironments.map(normalizeSlug));
  const cutoff = now.getTime() - maxAgeHours * 60 * 60 * 1_000;

  return workers
    .flatMap((worker) => {
      const workerName = String(worker.id ?? worker.name ?? "");
      if (!workerName.startsWith(workerPrefix)) return [];

      const environmentName = workerName.slice(environmentPrefix.length);
      if (!environmentName.startsWith("agent-") || excluded.has(environmentName)) {
        return [];
      }

      const timestamp = worker.modified_on ?? worker.created_on;
      const lastModified = new Date(timestamp);
      if (!timestamp || Number.isNaN(lastModified.getTime())) return [];
      if (lastModified.getTime() > cutoff) return [];

      return [
        {
          environmentName,
          workerName,
          lastModified: lastModified.toISOString(),
          ageHours: Math.floor(
            (now.getTime() - lastModified.getTime()) / (60 * 60 * 1_000)
          ),
        },
      ];
    })
    .sort((left, right) => right.ageHours - left.ageHours);
}

async function listWorkers() {
  const result = await cfApi("/workers/scripts");
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
  appName = getOptionalEnv("CLOUDFLARE_APP_NAME") ?? "ttv-website",
  destroy = destroyByEnvironmentName,
} = {}) {
  const candidates = findStaleAgentEnvironments({
    workers: workers ?? (await listWorkers()),
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
  const result = await sweepAgentEnvironments(
    parseSweepArgs(process.argv.slice(2))
  );
  console.log(JSON.stringify(result, null, 2));
  if (result.results?.some(({ status }) => status === "blocked")) {
    process.exitCode = 1;
  }
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
