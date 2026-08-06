import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deleteAiGatewayByName,
  deleteContainerAppByName,
  deleteD1DatabaseByName,
  deleteQueueByName,
  deleteR2BucketByName,
  deleteVectorizeIndexByName,
  deleteWorkerScript,
  removeQueueWorkerConsumer,
  deriveEnvironmentContext,
  getOptionalEnv,
  writeGithubOutput,
} from "./lib.mjs";

export function ensureEnvironmentCanBeDestroyed(environmentSlug) {
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
    deleteContainerApp = deleteContainerAppByName,
    deleteDatabase = deleteD1DatabaseByName,
    deleteQueue = deleteQueueByName,
    removeQueueConsumer = removeQueueWorkerConsumer,
    deleteBucket = deleteR2BucketByName,
    deleteVectorize = deleteVectorizeIndexByName,
    deleteWorker = deleteWorkerScript,
  } = {}
) {
  ensureEnvironmentCanBeDestroyed(context.environmentSlug);

  let bucketDeleted = false;
  try {
    bucketDeleted = await deleteBucket(context.bucketName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to delete R2 bucket "${context.bucketName}". Cloudflare only allows bucket deletion when the bucket is empty. Original error: ${message}`
    );
  }

  // Container apps reference the Worker's Durable Object namespace; delete
  // them before removing the Worker so no orphaned binding remains.
  const containerAppDeleted = await deleteContainerApp(
    context.containerAppName
  );

  // Cloudflare blocks Worker deletion while it is a Queue consumer and blocks
  // Queue deletion while the Worker still has its producer binding.
  const queueConsumerRemoved = await removeQueueConsumer(
    context.queueName,
    context.workerName
  );
  const workerDeleted = await deleteWorker(context.workerName);
  const queueDeleted = await deleteQueue(context.queueName);
  const vectorizeIndexDeleted = await deleteVectorize(
    context.vectorizeIndexName
  );
  const aiGatewayDeleted = await deleteAiGateway(context.aiGatewayName);
  const databaseDeleted = await deleteDatabase(context.d1Name);

  return {
    environment: context.environmentName,
    containerAppDeleted,
    queueConsumerRemoved,
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
  const result = await destroyEnvironment(context);

  await writeGithubOutput(
    "container_app_deleted",
    String(result.containerAppDeleted)
  );
  await writeGithubOutput(
    "queue_consumer_removed",
    String(result.queueConsumerRemoved)
  );
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
