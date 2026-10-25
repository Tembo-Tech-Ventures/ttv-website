import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveEnvironmentContext,
  ensureAiGateway,
  ensureD1Database,
  ensureQueue,
  ensureR2Bucket,
  ensureVectorizeIndex,
  ensureWorkersSubdomain,
  getOptionalEnv,
  getSecretBindings,
  queryD1Database,
  reclaimInactivePrPreviewAiGateways,
  resolveBetterAuthUrl,
  runNpm,
  runWrangler,
  setWorkerSecrets,
  writeGeneratedWranglerConfig,
  writeGithubOutput,
} from "./lib.mjs";
import {
  isAgentEnvironmentName,
  seedAgentPreviewAccess,
  seedAgentPreviewFixtures,
} from "./agent-preview-auth.mjs";
import { destroyEnvironment } from "./destroy.mjs";
import { assertNoBlockingDuplicates } from "./migration-preflight.mjs";

export function parseActivePrPreviewEnvironments(value) {
  return [
    ...new Set(value.split(",").map((entry) => entry.trim()).filter(Boolean)),
  ];
}

export async function reclaimClosedPrPreviewGateways(
  context,
  {
    activeEnvironmentValue = getOptionalEnv(
      "CLOUDFLARE_ACTIVE_PR_ENVIRONMENTS"
    ),
    reclaim = reclaimInactivePrPreviewAiGateways,
  } = {}
) {
  if (!/^agent-pr-[1-9]\d*$/.test(context.environmentSlug)) return [];
  if (!activeEnvironmentValue) {
    throw new Error(
      "GitHub PR previews require CLOUDFLARE_ACTIVE_PR_ENVIRONMENTS before gateway reclamation."
    );
  }

  const activeEnvironmentNames =
    parseActivePrPreviewEnvironments(activeEnvironmentValue);
  if (!activeEnvironmentNames.includes(context.environmentSlug)) {
    throw new Error(
      `Active PR preview inventory does not include the current environment "${context.environmentSlug}".`
    );
  }

  return reclaim({
    appName: context.appName,
    activeEnvironmentNames,
  });
}

export async function runDeploymentWithAgentCleanup(
  context,
  deploy,
  cleanup = destroyEnvironment
) {
  try {
    return await deploy();
  } catch (deploymentError) {
    if (!isAgentEnvironmentName(context.environmentName)) {
      throw deploymentError;
    }

    try {
      await cleanup(context);
    } catch (cleanupError) {
      const deploymentMessage =
        deploymentError instanceof Error
          ? deploymentError.message
          : String(deploymentError);
      const cleanupMessage =
        cleanupError instanceof Error
          ? cleanupError.message
          : String(cleanupError);
      const combinedError = new AggregateError(
        [deploymentError, cleanupError],
        `Agent deployment failed: ${deploymentMessage}. Cleanup also failed: ${cleanupMessage}`,
        { cause: deploymentError }
      );
      throw combinedError;
    }
    throw deploymentError;
  }
}

async function deployEnvironment(context, reclaimedAiGateways) {
  const primaryDomain = getOptionalEnv("CLOUDFLARE_PRIMARY_DOMAIN");
  const redirectDomain = getOptionalEnv("CLOUDFLARE_REDIRECT_DOMAIN");
  const configuredBetterAuthUrl = getOptionalEnv("CLOUDFLARE_BETTER_AUTH_URL");
  const samAlertWebhookUrl = getOptionalEnv("SAM_ALERT_WEBHOOK_URL");

  // Gateways are quota-bound. Provision one first so a quota error cannot
  // strand newly-created D1, R2, Queue, or Vectorize resources.
  await ensureAiGateway(context.aiGatewayName);
  const d1Database = await ensureD1Database(context.d1Name);
  await ensureR2Bucket(context.bucketName);
  await ensureQueue(context.queueName);
  await ensureVectorizeIndex(context.vectorizeIndexName);

  const workersSubdomain = await ensureWorkersSubdomain();
  const betterAuthUrl = resolveBetterAuthUrl({
    betterAuthUrl: configuredBetterAuthUrl,
    primaryDomain,
    workerName: context.workerName,
    workersSubdomain,
  });

  await runNpm(["run", "build"]);
  const configPath = await writeGeneratedWranglerConfig({
    workerName: context.workerName,
    containerAppName: context.containerAppName,
    d1Name: context.d1Name,
    d1Id: d1Database.uuid,
    bucketName: context.bucketName,
    queueName: context.queueName,
    vectorizeIndexName: context.vectorizeIndexName,
    aiGatewayName: context.aiGatewayName,
    primaryDomain,
    redirectDomain,
    betterAuthUrl,
    samAlertWebhookUrl,
  });

  await setWorkerSecrets(configPath, getSecretBindings());
  await assertNoBlockingDuplicates({
    databaseId: d1Database.uuid,
    executeQuery: queryD1Database,
  });
  await runWrangler([
    "d1",
    "migrations",
    "apply",
    context.d1Name,
    "--remote",
    "--config",
    configPath,
  ]);

  let agentAccess;
  if (isAgentEnvironmentName(context.environmentName)) {
    if (getOptionalEnv("CLOUDFLARE_AGENT_AUTH_ENABLED") !== "true") {
      throw new Error(
        "Isolated agent environments must enable CLOUDFLARE_AGENT_AUTH_ENABLED."
      );
    }
    agentAccess = await seedAgentPreviewAccess({
      databaseId: d1Database.uuid,
      environmentName: context.environmentName,
      previewSecret: getOptionalEnv("AGENT_PREVIEW_SECRET") ?? "",
      executeQuery: queryD1Database,
    });
    await seedAgentPreviewFixtures({
      databaseId: d1Database.uuid,
      executeQuery: queryD1Database,
      environmentName: context.environmentName,
      previewSecret: getOptionalEnv("AGENT_PREVIEW_SECRET") ?? "",
    });
  }

  await runWrangler(["deploy", "--config", configPath]);

  await writeGithubOutput("worker_name", context.workerName);
  await writeGithubOutput("database_name", context.d1Name);
  await writeGithubOutput("database_id", d1Database.uuid);
  await writeGithubOutput("bucket_name", context.bucketName);
  await writeGithubOutput("queue_name", context.queueName);
  await writeGithubOutput("vectorize_index_name", context.vectorizeIndexName);
  await writeGithubOutput("ai_gateway_name", context.aiGatewayName);
  await writeGithubOutput("better_auth_url", betterAuthUrl);
  if (primaryDomain) {
    await writeGithubOutput("primary_domain", primaryDomain);
  }
  if (redirectDomain) {
    await writeGithubOutput("redirect_domain", redirectDomain);
  }

  console.log(
    JSON.stringify(
      {
        environment: context.environmentName,
        workerName: context.workerName,
        databaseId: d1Database.uuid,
        bucketName: context.bucketName,
        queueName: context.queueName,
        vectorizeIndexName: context.vectorizeIndexName,
        aiGatewayName: context.aiGatewayName,
        reclaimedAiGateways,
        betterAuthUrl,
        primaryDomain,
        redirectDomain,
        agentAccess: agentAccess
          ? { seeded: true, expiresAt: agentAccess.expiresAt.toISOString() }
          : undefined,
      },
      null,
      2
    )
  );
}

async function main() {
  const context = deriveEnvironmentContext();
  // The GitHub workflow supplies the authoritative open-PR inventory. Run
  // this before provisioning so an inventory error cannot trigger rollback
  // of an otherwise healthy current preview.
  const reclaimedAiGateways = await reclaimClosedPrPreviewGateways(context);
  return runDeploymentWithAgentCleanup(context, () =>
    deployEnvironment(context, reclaimedAiGateways)
  );
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
