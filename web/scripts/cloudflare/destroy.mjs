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
  listR2BucketObjectsPage,
  writeGithubOutput,
} from "./lib.mjs";

export function ensureEnvironmentCanBeDestroyed(environmentSlug) {
  const protectedEnvironments = new Set([
    "production",
    "prod",
    "staging",
    ...(getOptionalEnv("CLOUDFLARE_PROTECTED_ENVIRONMENTS") ?? "")
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean),
  ]);
  const allowProtectedDestroy =
    getOptionalEnv("CLOUDFLARE_ALLOW_PROTECTED_DESTROY") === "true";

  if (
    protectedEnvironments.has(environmentSlug) &&
    !allowProtectedDestroy
  ) {
    throw new Error(
      `Refusing to destroy protected environment "${environmentSlug}". Set CLOUDFLARE_ALLOW_PROTECTED_DESTROY=true to override.`
    );
  }
}

export function ensureAgentBucketMatchesEnvironment(context) {
  const { appName, bucketName, environmentSlug } = context;
  const expectedPrefix = `${appName}-files-agent-`;
  const expectedBucketName = `${appName}-files-${environmentSlug}`.slice(0, 63);

  if (!environmentSlug.startsWith("agent-")) {
    throw new Error(
      `Refusing to inspect R2 bucket for non-agent environment "${environmentSlug}".`
    );
  }
  if (
    !bucketName.startsWith(expectedPrefix) ||
    bucketName !== expectedBucketName
  ) {
    throw new Error(
      `Refusing to inspect R2 bucket "${bucketName}". Expected an exact "${expectedPrefix}" bucket for environment "${environmentSlug}".`
    );
  }
}

export async function ensureAgentR2BucketEmpty(
  context,
  { listObjectsPage = listR2BucketObjectsPage } = {}
) {
  ensureAgentBucketMatchesEnvironment(context);

  let cursor;
  const seenCursors = new Set();

  do {
    const page = await listObjectsPage(context.bucketName, cursor, {
      requireCompleteMetadata: true,
    });
    if (page === null) return;

    const hasNoDelimitedPrefixes =
      page &&
      (page.delimitedPrefixes === undefined ||
        (Array.isArray(page.delimitedPrefixes) &&
          page.delimitedPrefixes.length === 0));
    const hasValidContinuation =
      page?.isTruncated === false
        ? page.cursor === undefined
        : page?.isTruncated === true &&
          typeof page.cursor === "string" &&
          page.cursor.length > 0 &&
          !seenCursors.has(page.cursor);

    // Any object, prefix, incomplete page or malformed continuation is not
    // proof of emptiness. Preserve the entire environment and never log keys.
    if (
      !page ||
      !Array.isArray(page.objects) ||
      page.objects.length > 0 ||
      !hasNoDelimitedPrefixes ||
      !hasValidContinuation
    ) {
      throw new Error(
        `Refusing to destroy environment "${context.environmentSlug}": R2 bucket is nonempty or emptiness could not be verified. Preserve the environment for review.`
      );
    }

    if (!page.isTruncated) return;
    seenCursors.add(page.cursor);
    cursor = page.cursor;
  } while (cursor);
}

export async function destroyEnvironment(
  context,
  {
    deleteAiGateway = deleteAiGatewayByName,
    deleteContainerApp = deleteContainerAppByName,
    deleteDatabase = deleteD1DatabaseByName,
    deleteQueue = deleteQueueByName,
    removeQueueConsumer = removeQueueWorkerConsumer,
    listObjectsPage = listR2BucketObjectsPage,
    deleteBucket = deleteR2BucketByName,
    deleteVectorize = deleteVectorizeIndexByName,
    deleteWorker = deleteWorkerScript,
  } = {}
) {
  ensureEnvironmentCanBeDestroyed(context.environmentSlug);

  const bucketObjectsDeleted = 0;
  let bucketDeleted = false;
  try {
    if (context.environmentSlug.startsWith("agent-")) {
      await ensureAgentR2BucketEmpty(context, { listObjectsPage });
    }
    bucketDeleted = await deleteBucket(context.bucketName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to safely delete R2 bucket "${context.bucketName}". Original error: ${message}`,
      { cause: error }
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
    bucketObjectsDeleted,
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
  await writeGithubOutput(
    "bucket_objects_deleted",
    String(result.bucketObjectsDeleted)
  );
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
