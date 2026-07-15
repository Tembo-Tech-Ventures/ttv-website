import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveAgentEnvironmentName,
  deriveEnvironmentContext,
  ensureWorkersSubdomain,
  getOptionalEnv,
  runGit,
  runNpm,
  runWrangler,
} from "./lib.mjs";
import { runSmokeChecks } from "./smoke.mjs";

export function prepareAgentEnvironment(environment = process.env) {
  const environmentName = deriveAgentEnvironmentName(environment);
  environment.CLOUDFLARE_ENVIRONMENT_NAME = environmentName;
  environment.CLOUDFLARE_PRIMARY_DOMAIN = "";
  environment.CLOUDFLARE_REDIRECT_DOMAIN = "";
  environment.CLOUDFLARE_BETTER_AUTH_URL = "";
  environment.CLOUDFLARE_AGENT_AUTH_ENABLED = "true";
  return environmentName;
}

async function resolveGitVersion() {
  const { stdout } = await runGit(["rev-parse", "--short=12", "HEAD"]);
  return stdout.trim();
}

export function resolveAgentDeploymentVersion(environment, gitVersion) {
  return (
    environment.CLOUDFLARE_DEPLOYMENT_VERSION?.trim() ||
    environment.GITHUB_SHA?.trim() ||
    gitVersion
  );
}

async function getWorkersSubdomain() {
  const subdomain =
    getOptionalEnv("CLOUDFLARE_WORKERS_SUBDOMAIN") ??
    (await ensureWorkersSubdomain());
  if (!subdomain) {
    throw new Error(
      "A Workers subdomain is required for an isolated agent environment."
    );
  }
  process.env.CLOUDFLARE_WORKERS_SUBDOMAIN = subdomain;
  return subdomain;
}

export async function main(args = process.argv.slice(2)) {
  const action = args[0] ?? "context";
  const environmentName = prepareAgentEnvironment();
  const context = deriveEnvironmentContext();

  if (action === "context") {
    const workersSubdomain = getOptionalEnv("CLOUDFLARE_WORKERS_SUBDOMAIN");
    return {
      ...context,
      url: workersSubdomain
        ? `https://${context.workerName}.${workersSubdomain}.workers.dev`
        : undefined,
    };
  }

  if (action === "destroy") {
    await runNpm(["run", "cf:destroy"]);
    return { environment: environmentName, destroyed: true };
  }

  if (action === "tail") {
    await runWrangler(["tail", context.workerName, "--format", "json"]);
    return { environment: environmentName, tailing: true };
  }

  if (action !== "deploy") {
    throw new Error(
      `Unknown action "${action}". Use context, deploy, tail, or destroy.`
    );
  }

  const workersSubdomain = await getWorkersSubdomain();
  const version = resolveAgentDeploymentVersion(
    process.env,
    await resolveGitVersion()
  );
  process.env.CLOUDFLARE_DEPLOYMENT_VERSION = version;
  await runNpm(["run", "cf:deploy"]);

  const baseUrl =
    `https://${context.workerName}.${workersSubdomain}.workers.dev`;
  const smoke = await runSmokeChecks({
    baseUrl,
    expectedEnvironment: environmentName,
    expectedVersion: version,
  });
  return { ...smoke, deployed: true };
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
}
