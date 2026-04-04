import {
  deleteD1DatabaseByName,
  deleteR2BucketByName,
  deleteWorkerScript,
  deriveEnvironmentContext,
  getOptionalEnv,
  writeGithubOutput,
} from "./lib.mjs";

function ensureEnvironmentCanBeDestroyed(environmentSlug) {
  const protectedEnvironments = (
    getOptionalEnv("CLOUDFLARE_PROTECTED_ENVIRONMENTS") ?? "production,prod"
  )
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  const allowProtectedDestroy =
    getOptionalEnv("CLOUDFLARE_ALLOW_PROTECTED_DESTROY") === "true";

  if (
    protectedEnvironments.includes(environmentSlug) &&
    !allowProtectedDestroy
  ) {
    throw new Error(
      `Refusing to destroy protected environment "${environmentSlug}". Set CLOUDFLARE_ALLOW_PROTECTED_DESTROY=true to override.`
    );
  }
}

async function main() {
  const context = deriveEnvironmentContext();
  ensureEnvironmentCanBeDestroyed(context.environmentSlug);

  const workerDeleted = await deleteWorkerScript(context.workerName);
  const databaseDeleted = await deleteD1DatabaseByName(context.d1Name);

  let bucketDeleted = false;
  try {
    bucketDeleted = await deleteR2BucketByName(context.bucketName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to delete R2 bucket "${context.bucketName}". Cloudflare only allows bucket deletion when the bucket is empty. Original error: ${message}`
    );
  }

  await writeGithubOutput("worker_deleted", String(workerDeleted));
  await writeGithubOutput("database_deleted", String(databaseDeleted));
  await writeGithubOutput("bucket_deleted", String(bucketDeleted));

  console.log(
    JSON.stringify(
      {
        environment: context.environmentName,
        workerDeleted,
        databaseDeleted,
        bucketDeleted,
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
