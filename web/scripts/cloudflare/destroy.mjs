import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deleteAiGatewayByName,
  deleteContainerAppByName,
  deleteD1DatabaseByName,
  deleteQueueByName,
  deleteR2BucketByName,
  deleteR2BucketObject,
  deleteVectorizeIndexByName,
  deleteWorkerScript,
  removeQueueWorkerConsumer,
  deriveEnvironmentContext,
  getOptionalEnv,
  listR2BucketObjectsPage,
  writeGithubOutput,
} from "./lib.mjs";

const R2_DELETE_CONCURRENCY = 25;

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

export function ensureAgentBucketCanBeEmptied(context) {
  const { appName, bucketName, environmentSlug } = context;
  const expectedPrefix = `${appName}-files-agent-`;
  const expectedBucketName = `${appName}-files-${environmentSlug}`.slice(0, 63);

  if (!environmentSlug.startsWith("agent-")) {
    throw new Error(
      `Refusing to empty R2 bucket for non-agent environment "${environmentSlug}".`
    );
  }
  if (
    !bucketName.startsWith(expectedPrefix) ||
    bucketName !== expectedBucketName
  ) {
    throw new Error(
      `Refusing to empty R2 bucket "${bucketName}". Expected an exact "${expectedPrefix}" bucket for environment "${environmentSlug}".`
    );
  }
}

export async function emptyAgentR2Bucket(
  context,
  {
    listObjectsPage = listR2BucketObjectsPage,
    deleteObject = deleteR2BucketObject,
  } = {}
) {
  ensureAgentBucketCanBeEmptied(context);

  let cursor;
  let objectsDeleted = 0;
  const seenCursors = new Set();

  do {
    const page = await listObjectsPage(context.bucketName, cursor);
    if (!page) {
      return { bucketFound: false, objectsDeleted };
    }

    const keys = page.objects.map((object) => {
      if (typeof object?.key !== "string") {
        throw new TypeError(
          `R2 object list for bucket "${context.bucketName}" contained an object without a string key.`
        );
      }
      return object.key;
    });

    for (let offset = 0; offset < keys.length; offset += R2_DELETE_CONCURRENCY) {
      const results = await Promise.all(
        keys
          .slice(offset, offset + R2_DELETE_CONCURRENCY)
          .map((key) => deleteObject(context.bucketName, key))
      );
      objectsDeleted += results.filter(Boolean).length;
    }

    if (!page.isTruncated) {
      return { bucketFound: true, objectsDeleted };
    }
    if (!page.cursor) {
      throw new Error(
        `Cloudflare reported a truncated R2 object list for bucket "${context.bucketName}" without a cursor.`
      );
    }
    if (seenCursors.has(page.cursor)) {
      throw new Error(
        `Cloudflare repeated R2 object-list cursor "${page.cursor}" for bucket "${context.bucketName}".`
      );
    }
    seenCursors.add(page.cursor);
    cursor = page.cursor;
  } while (cursor);

  return { bucketFound: true, objectsDeleted };
}

export async function destroyEnvironment(
  context,
  {
    deleteAiGateway = deleteAiGatewayByName,
    deleteContainerApp = deleteContainerAppByName,
    deleteDatabase = deleteD1DatabaseByName,
    deleteQueue = deleteQueueByName,
    removeQueueConsumer = removeQueueWorkerConsumer,
    emptyBucket = emptyAgentR2Bucket,
    deleteBucket = deleteR2BucketByName,
    deleteVectorize = deleteVectorizeIndexByName,
    deleteWorker = deleteWorkerScript,
  } = {}
) {
  ensureEnvironmentCanBeDestroyed(context.environmentSlug);

  let bucketObjectsDeleted = 0;
  let bucketDeleted = false;
  try {
    if (context.environmentSlug.startsWith("agent-")) {
      const cleanup = await emptyBucket(context);
      bucketObjectsDeleted = cleanup.objectsDeleted;
    }
    bucketDeleted = await deleteBucket(context.bucketName);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Failed to empty and delete R2 bucket "${context.bucketName}". Original error: ${message}`,
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
