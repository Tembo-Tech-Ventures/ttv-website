import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deleteAiGatewayByName,
  deleteD1DatabaseByName,
  deleteQueueByName,
  deleteR2BucketByName,
  deleteVectorizeIndexByName,
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

export async function destroyEnvironment(
  context,
  {
    deleteAiGateway = deleteAiGatewayByName,
    deleteDatabase = deleteD1DatabaseByName,
    deleteQueue = deleteQueueByName,
    deleteBucket = deleteR2BucketByName,
    deleteVectorize = deleteVectorizeIndexByName,
    deleteWorker = deleteWorkerScript,
  } = {}
) {
  let bucketDeleted = false;
  try {
    bucketDeleted = await deleteBucket(context.bucketName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to delete R2 bucket "${context.bucketName}". Cloudflare only allows bucket deletion when the bucket is empty. Original error: ${message}`
    );
  }

  const workerDeleted = await deleteWorker(context.workerName);
  const queueDeleted = await deleteQueue(context.queueName);
  const vectorizeIndexDeleted = await deleteVectorize(
    context.vectorizeIndexName
  );
  const aiGatewayDeleted = await deleteAiGateway(context.aiGatewayName);
  const databaseDeleted = await deleteDatabase(context.d1Name);

  return {
    environment: context.environmentName,
    workerDeleted,
    queueDeleted,
    vectorizeIndexDeleted,
    aiGatewayDeleted,
    databaseDeleted,
    bucketDeleted,
  };
}

async function main() {
  const context = deriveEnvironmentContext();
  ensureEnvironmentCanBeDestroyed(context.environmentSlug);
  const result = await destroyEnvironment(context);

  await writeGithubOutput("worker_deleted", String(result.workerDeleted));
  await writeGithubOutput("queue_deleted", String(result.queueDeleted));
  await writeGithubOutput(
    "vectorize_index_deleted",
    String(result.vectorizeIndexDeleted)
  );
  await writeGithubOutput(
    "ai_gateway_deleted",
    String(result.aiGatewayDeleted)
  );
  await writeGithubOutput("database_deleted", String(result.databaseDeleted));
  await writeGithubOutput("bucket_deleted", String(result.bucketDeleted));

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
