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
import { assertNoBlockingDuplicates } from "./migration-preflight.mjs";

async function main() {
  const context = deriveEnvironmentContext();
  const primaryDomain = getOptionalEnv("CLOUDFLARE_PRIMARY_DOMAIN");
  const redirectDomain = getOptionalEnv("CLOUDFLARE_REDIRECT_DOMAIN");
  const configuredBetterAuthUrl = getOptionalEnv("CLOUDFLARE_BETTER_AUTH_URL");

  const d1Database = await ensureD1Database(context.d1Name);
  await ensureR2Bucket(context.bucketName);
  await ensureQueue(context.queueName);
  await ensureVectorizeIndex(context.vectorizeIndexName);
  await ensureAiGateway(context.aiGatewayName);

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

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
