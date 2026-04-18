import {
  deriveEnvironmentContext,
  ensureD1Database,
  ensureR2Bucket,
  ensureWorkersSubdomain,
  enableWorkersDevSubdomain,
  getOptionalEnv,
  getSecretBindings,
  resolveBetterAuthUrl,
  runNpm,
  runWrangler,
  setWorkerSecrets,
  writeGeneratedWranglerConfig,
  writeGithubOutput,
} from "./lib.mjs";

async function main() {
  const context = deriveEnvironmentContext();
  const primaryDomain = getOptionalEnv("CLOUDFLARE_PRIMARY_DOMAIN");
  const redirectDomain = getOptionalEnv("CLOUDFLARE_REDIRECT_DOMAIN");
  const configuredBetterAuthUrl = getOptionalEnv("CLOUDFLARE_BETTER_AUTH_URL");

  const d1Database = await ensureD1Database(context.d1Name);
  await ensureR2Bucket(context.bucketName);

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
    d1Name: context.d1Name,
    d1Id: d1Database.uuid,
    bucketName: context.bucketName,
    primaryDomain,
    redirectDomain,
    betterAuthUrl,
  });

  await setWorkerSecrets(configPath, getSecretBindings());
  await runWrangler([
    "d1",
    "migrations",
    "apply",
    context.d1Name,
    "--remote",
    "--config",
    configPath,
  ]);
  await runWrangler(["deploy", "--config", configPath]);

  if (!primaryDomain && workersSubdomain) {
    await enableWorkersDevSubdomain(context.workerName);
  }

  await writeGithubOutput("worker_name", context.workerName);
  await writeGithubOutput("database_name", context.d1Name);
  await writeGithubOutput("database_id", d1Database.uuid);
  await writeGithubOutput("bucket_name", context.bucketName);
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
        betterAuthUrl,
        primaryDomain,
        redirectDomain,
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
