import { afterEach, describe, expect, it, vi } from "vitest";
import {
  destroyEnvironment,
  ensureAgentR2BucketEmpty,
} from "./destroy.mjs";

const context = {
  appName: "ttv-website",
  environmentName: "agent-123",
  environmentSlug: "agent-123",
  workerName: "worker",
  containerAppName: "worker-ffmpegcontainer",
  queueName: "queue",
  vectorizeIndexName: "vector",
  aiGatewayName: "gateway",
  d1Name: "database",
  bucketName: "ttv-website-files-agent-123",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("destroyEnvironment", () => {
  it("checks and deletes empty R2 before removing the rest of the environment", async () => {
    const order = [];
    const operation = (name) =>
      vi.fn(async () => {
        order.push(name);
        return true;
      });
    const dependencies = {
      listObjectsPage: vi.fn(async () => {
        order.push("listObjectsPage");
        return { objects: [], isTruncated: false };
      }),
      deleteBucket: operation("bucket"),
      deleteContainerApp: operation("containerApp"),
      removeQueueConsumer: operation("consumer"),
      deleteWorker: operation("worker"),
      deleteQueue: operation("queue"),
      deleteVectorize: operation("vector"),
      deleteAiGateway: operation("gateway"),
      deleteDatabase: operation("database"),
    };

    await expect(
      destroyEnvironment(context, dependencies)
    ).resolves.toEqual({
      environment: "agent-123",
      containerAppDeleted: true,
      queueConsumerRemoved: true,
      workerDeleted: true,
      queueDeleted: true,
      vectorizeIndexDeleted: true,
      aiGatewayDeleted: true,
      databaseDeleted: true,
      bucketObjectsDeleted: 0,
      bucketDeleted: true,
    });
    expect(order).toEqual([
      "listObjectsPage",
      "bucket",
      "containerApp",
      "consumer",
      "worker",
      "queue",
      "vector",
      "gateway",
      "database",
    ]);
  });

  it("surfaces an R2 API error and leaves the rest of the environment intact", async () => {
    const deleteContainerApp = vi.fn();
    const deleteWorker = vi.fn();
    await expect(
      destroyEnvironment(context, {
        listObjectsPage: vi
          .fn()
          .mockRejectedValue(
            new Error(
              "GET /r2/buckets/example/objects failed: API unavailable"
            )
          ),
        deleteContainerApp,
        deleteWorker,
      })
    ).rejects.toThrow(
      'Failed to safely delete R2 bucket "ttv-website-files-agent-123". Original error: GET /r2/buckets/example/objects failed: API unavailable'
    );
    expect(deleteContainerApp).not.toHaveBeenCalled();
    expect(deleteWorker).not.toHaveBeenCalled();
  });

  it("does not attempt Worker deletion when Queue consumer removal fails", async () => {
    const deleteWorker = vi.fn();
    await expect(
      destroyEnvironment(context, {
        listObjectsPage: vi
          .fn()
          .mockResolvedValue({ objects: [], isTruncated: false }),
        deleteBucket: vi.fn().mockResolvedValue(true),
        deleteContainerApp: vi.fn().mockResolvedValue(true),
        removeQueueConsumer: vi
          .fn()
          .mockRejectedValue(new Error("consumer remove failed")),
        deleteWorker,
      })
    ).rejects.toThrow("consumer remove failed");
    expect(deleteWorker).not.toHaveBeenCalled();
  });

  it("enforces protected-environment policy inside the reusable destroy function", async () => {
    const deleteBucket = vi.fn();
    await expect(
      destroyEnvironment(
        {
          ...context,
          bucketName: "ttv-website-files-production",
          environmentName: "production",
          environmentSlug: "production",
        },
        { deleteBucket }
      )
    ).rejects.toThrow('Refusing to destroy protected environment "production"');
    expect(deleteBucket).not.toHaveBeenCalled();

    vi.stubEnv("CLOUDFLARE_ALLOW_PROTECTED_DESTROY", "true");
    const operation = vi.fn().mockResolvedValue(true);
    const listObjectsPage = vi.fn();
    await expect(
      destroyEnvironment(
        {
          ...context,
          bucketName: "ttv-website-files-production",
          environmentName: "production",
          environmentSlug: "production",
        },
        {
          listObjectsPage,
          deleteBucket: operation,
          deleteContainerApp: operation,
          removeQueueConsumer: operation,
          deleteWorker: operation,
          deleteQueue: operation,
          deleteVectorize: operation,
          deleteAiGateway: operation,
          deleteDatabase: operation,
        }
      )
    ).resolves.toMatchObject({
      environment: "production",
      bucketObjectsDeleted: 0,
    });
    expect(listObjectsPage).not.toHaveBeenCalled();
  });
});

describe("R2 preservation preflight", () => {
  const mutators = ["deleteBucket", "deleteContainerApp", "removeQueueConsumer", "deleteWorker", "deleteQueue", "deleteVectorize", "deleteAiGateway", "deleteDatabase"];
  const mutations = () => Object.fromEntries(mutators.map(name => [name, vi.fn().mockResolvedValue(false)]));
  it.each([
    { objects: [{ key: "private-key-not-for-logs" }], isTruncated: false },
    { objects: [], isTruncated: true, cursor: "more" },
    { objects: [], isTruncated: true },
    { objects: [] },
    { objects: null, isTruncated: false },
    undefined,
  ])("preserves every resource for nonempty or uncertain listing %j", async page => {
    const dependencies = mutations();
    dependencies.listObjectsPage = vi.fn().mockResolvedValue(page);
    await expect(destroyEnvironment(context, dependencies)).rejects.toThrow("Preserve the environment for review");
    for (const name of mutators) expect(dependencies[name]).not.toHaveBeenCalled();
    expect(dependencies.listObjectsPage).toHaveBeenCalledTimes(1);
  });
  it("does not reveal object keys in the refusal", async () => {
    await expect(ensureAgentR2BucketEmpty(context, {
      listObjectsPage: vi.fn().mockResolvedValue({ objects: [{ key: "private-key-not-for-logs" }], isTruncated: false }),
    })).rejects.not.toThrow("private-key-not-for-logs");
  });
  it("allows idempotent teardown after the bucket is already absent", async () => {
    const dependencies = mutations();
    dependencies.listObjectsPage = vi.fn().mockResolvedValue(null);
    await expect(destroyEnvironment(context, dependencies)).resolves.toMatchObject({ bucketObjectsDeleted: 0, bucketDeleted: false });
    for (const name of mutators) expect(dependencies[name]).toHaveBeenCalledTimes(1);
  });
  it("stops further deletion if an object arrives after the empty check", async () => {
    const dependencies = mutations();
    dependencies.listObjectsPage = vi.fn().mockResolvedValue({ objects: [], isTruncated: false });
    dependencies.deleteBucket.mockRejectedValue(new Error("Bucket is not empty"));
    await expect(destroyEnvironment(context, dependencies)).rejects.toThrow("Bucket is not empty");
    for (const name of mutators.filter(operationName => operationName !== "deleteBucket")) expect(dependencies[name]).not.toHaveBeenCalled();
  });
  it.each(["production", "prod", "staging"])("refuses agent preflight for %s even with override", async environmentSlug => {
    vi.stubEnv("CLOUDFLARE_ALLOW_PROTECTED_DESTROY", "true");
    const listObjectsPage = vi.fn();
    await expect(ensureAgentR2BucketEmpty({ ...context, environmentSlug }, { listObjectsPage })).rejects.toThrow("non-agent environment");
    expect(listObjectsPage).not.toHaveBeenCalled();
  });
  it.each(["ttv-website-files-production", "ttv-website-files-agent-other"])("rejects mismatched bucket %s before mutation", async bucketName => {
    const dependencies = mutations();
    dependencies.listObjectsPage = vi.fn();
    await expect(destroyEnvironment({ ...context, bucketName }, dependencies)).rejects.toThrow("Expected an exact");
    for (const fn of Object.values(dependencies)) expect(fn).not.toHaveBeenCalled();
  });
});

describe("real R2 adapter teardown boundary", () => {
  const mutators = ["deleteBucket", "deleteContainerApp", "removeQueueConsumer", "deleteWorker", "deleteQueue", "deleteVectorize", "deleteAiGateway", "deleteDatabase"];
  function setup(payload, status = 200) {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "fictional-account");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "fictional-test-token");
    const fetcher = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload), { status }));
    vi.stubGlobal("fetch", fetcher);
    return Object.fromEntries(mutators.map(name => [name, vi.fn().mockResolvedValue(true)]));
  }
  it.each([
    undefined, {}, { is_truncated: "true" }, { is_truncated: true },
    { is_truncated: false, cursor: "more" },
    { is_truncated: false, cursor: 42 },
    { is_truncated: false, delimited: ["hidden-prefix/"] },
  ])("blocks every mutation on missing/malformed/truncated raw metadata %j", async result_info => {
    const dependencies = setup({ success: true, result: [], result_info });
    await expect(destroyEnvironment(context, dependencies)).rejects.toThrow("Failed to safely delete R2 bucket");
    for (const fn of Object.values(dependencies)) expect(fn).not.toHaveBeenCalled();
  });
  it.each([401, 403, 500, 404])("does not treat HTTP %i as verified missing bucket", async status => {
    const dependencies = setup({ success: false, errors: [{ code: 9999 }] }, status);
    await expect(destroyEnvironment(context, dependencies)).rejects.toThrow("Failed to safely delete R2 bucket");
    for (const fn of Object.values(dependencies)) expect(fn).not.toHaveBeenCalled();
  });
  it.each([
    [200, { success: true, result: [], result_info: { is_truncated: false, cursor: "", delimited: [] } }],
    [404, { success: false, errors: [{ code: 10006 }] }],
  ])("permits verified empty or bucket-not-found response %i", async (status, payload) => {
    const dependencies = setup(payload, status);
    await expect(destroyEnvironment(context, dependencies)).resolves.toMatchObject({ bucketObjectsDeleted: 0 });
    for (const fn of Object.values(dependencies)) expect(fn).toHaveBeenCalledTimes(1);
  });
});
