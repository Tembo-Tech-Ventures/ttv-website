import path from "node:path";
import { fileURLToPath } from "node:url";
import { runWrangler, writeGithubOutput } from "./lib.mjs";

const VERSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireOption(options, name) {
  const value = options[name]?.trim();
  if (!value) {
    const argumentName = name.replaceAll(
      /[A-Z]/g,
      (match) => `-${match.toLowerCase()}`
    );
    throw new Error(`Missing required --${argumentName} argument.`);
  }
  return value;
}

function normalizeHttpUrl(value, label) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${label} must use HTTP or HTTPS.`);
  }
  if (url.username || url.password) {
    throw new Error(`${label} must not include credentials.`);
  }
  return url.toString();
}

function assertProductionEnvironment(environmentName) {
  if (environmentName.startsWith("agent-")) {
    throw new Error("Rollback is forbidden for agent-* preview environments.");
  }
  if (environmentName !== "production") {
    throw new Error(
      `Rollback is restricted to the production environment, not "${environmentName}".`
    );
  }
}

export function parseRollbackArgs(args) {
  const [command, ...optionArgs] = args;
  if (!["capture", "rollback"].includes(command)) {
    throw new Error('Expected rollback command "capture" or "rollback".');
  }

  const options = { command, dryRun: false };
  for (const arg of optionArgs) {
    if (arg === "--dry-run") {
      options.dryRun = true;
      continue;
    }

    const [name, ...valueParts] = arg.split("=");
    const value = valueParts.join("=").trim();
    if (!value || !name.startsWith("--")) {
      throw new Error(`Invalid rollback argument: ${arg}`);
    }

    if (name === "--environment") options.environmentName = value;
    else if (name === "--worker-name") options.workerName = value;
    else if (name === "--health-url") options.healthUrl = value;
    else if (name === "--version-id") options.versionId = value;
    else throw new Error(`Unknown rollback argument: ${name}`);
  }

  options.environmentName = requireOption(options, "environmentName");
  options.workerName = requireOption(options, "workerName");
  assertProductionEnvironment(options.environmentName);

  if (command === "capture") {
    if (options.dryRun) {
      throw new Error("--dry-run is only supported by the rollback command.");
    }
    options.healthUrl = normalizeHttpUrl(
      requireOption(options, "healthUrl"),
      "Rollback health URL"
    );
  } else {
    options.versionId = requireOption(options, "versionId");
    if (!VERSION_ID_PATTERN.test(options.versionId)) {
      throw new Error("Rollback --version-id must be a Worker version UUID.");
    }
  }

  return options;
}

export function activeVersionIdFromDeployment(deployment) {
  if (!deployment || !Array.isArray(deployment.versions)) {
    throw new Error("Wrangler returned an invalid active deployment payload.");
  }

  const activeVersions = deployment.versions.filter(
    ({ percentage }) => Number(percentage) === 100
  );
  if (deployment.versions.length !== 1 || activeVersions.length !== 1) {
    throw new Error(
      "Production must have one Worker version serving 100% of traffic before deploy."
    );
  }

  const versionId = activeVersions[0].version_id;
  if (typeof versionId !== "string" || !VERSION_ID_PATTERN.test(versionId)) {
    throw new Error("Wrangler returned an invalid active Worker version ID.");
  }
  return versionId;
}

export async function captureRollbackTarget(
  options,
  {
    runWranglerImpl = runWrangler,
    fetchImpl = fetch,
    writeOutput = writeGithubOutput,
  } = {}
) {
  assertProductionEnvironment(options.environmentName);

  const [deploymentResult, healthResponse] = await Promise.all([
    runWranglerImpl([
      "deployments",
      "status",
      "--name",
      options.workerName,
      "--json",
    ]),
    fetchImpl(options.healthUrl, {
      headers: { Accept: "application/json" },
      redirect: "follow",
      signal: globalThis.AbortSignal.timeout(15_000),
    }),
  ]);

  if (!healthResponse.ok) {
    throw new Error(
      `Rollback health capture returned HTTP ${healthResponse.status}.`
    );
  }

  let deployment;
  try {
    deployment = JSON.parse(deploymentResult.stdout);
  } catch {
    throw new Error("Wrangler returned non-JSON deployment status output.");
  }
  const workerVersionId = activeVersionIdFromDeployment(deployment);

  const health = await healthResponse.json();
  if (health?.environment !== "production") {
    throw new Error(
      `Rollback health capture expected production but received "${health?.environment ?? "unknown"}".`
    );
  }
  if (typeof health.version !== "string" || !health.version.trim()) {
    throw new Error("Rollback health capture did not include a served version.");
  }

  await Promise.all([
    writeOutput("worker_version_id", workerVersionId),
    writeOutput("health_version", health.version),
  ]);

  return {
    environment: options.environmentName,
    workerName: options.workerName,
    workerVersionId,
    healthVersion: health.version,
  };
}

export async function rollbackProduction(
  options,
  { runWranglerImpl = runWrangler, log = console.log } = {}
) {
  assertProductionEnvironment(options.environmentName);
  const wranglerArgs = [
    "rollback",
    options.versionId,
    "--name",
    options.workerName,
    "--message",
    "Automated rollback after failed production verification",
  ];

  if (options.dryRun) {
    log(
      `Dry run: would roll back ${options.workerName} to Worker version ${options.versionId}.`
    );
    return { dryRun: true, wranglerArgs };
  }

  await runWranglerImpl(wranglerArgs);
  return { dryRun: false, wranglerArgs };
}

async function main() {
  const options = parseRollbackArgs(process.argv.slice(2));
  const result =
    options.command === "capture"
      ? await captureRollbackTarget(options)
      : await rollbackProduction(options);
  console.log(JSON.stringify(result, null, 2));
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
