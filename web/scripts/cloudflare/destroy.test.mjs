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
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    const fetcher = vi.fn().mockResolvedValue(new Response(body, { status }));
    vi.stubGlobal("fetch", fetcher);
    return Object.fromEntries(mutators.map(name => [name, vi.fn().mockResolvedValue(true)]));
  }
  // What Cloudflare returned for every empty agent-pr bucket from 2026-10-24
  // (e.g. PR #321's close run): HTTP 200, success true, no result_info at all.
  const observedEmptyListing = { success: true, errors: [], messages: [], result: [] };

  it.each([
    null, [], "complete", { is_truncated: "true" }, { is_truncated: "false" }, { is_truncated: true },
    { is_truncated: true, cursor: "" },
    { is_truncated: false, cursor: "more" },
    { is_truncated: false, cursor: 42 },
    { cursor: "more" },
    { is_truncated: false, delimited: ["hidden-prefix/"] },
    { delimited: ["hidden-prefix/"] },
    { is_truncated: false, delimited: "hidden-prefix/" },
  ])("blocks every mutation on malformed, truncated or continued metadata %j", async result_info => {
    const dependencies = setup({ ...observedEmptyListing, result_info });
    await expect(destroyEnvironment(context, dependencies)).rejects.toThrow("R2 listing completion metadata could not be verified");
    for (const fn of Object.values(dependencies)) expect(fn).not.toHaveBeenCalled();
  });
  it.each([
    ["objects without metadata", { success: true, result: [{ key: "private-key-not-for-logs" }] }],
    ["objects without is_truncated", { success: true, result: [{ key: "private-key-not-for-logs" }], result_info: {} }],
  ])("requires explicit completion metadata for %s", async (_shape, payload) => {
    const dependencies = setup(payload);
    await expect(destroyEnvironment(context, dependencies)).rejects.toThrow("R2 listing completion metadata could not be verified");
    for (const fn of Object.values(dependencies)) expect(fn).not.toHaveBeenCalled();
  });
  it.each([
    ["no success flag", { result: [] }],
    ["a non-boolean success flag", { success: "true", result: [] }],
    ["a missing result", { success: true }],
    ["a non-array result", { success: true, result: { objects: [] } }],
    ["an empty body", ""],
    ["a non-JSON body", "<html>bad gateway</html>"],
  ])("blocks every mutation on a 200 response with %s", async (_shape, payload) => {
    const dependencies = setup(payload);
    await expect(destroyEnvironment(context, dependencies)).rejects.toThrow("Failed to safely delete R2 bucket");
    for (const fn of Object.values(dependencies)) expect(fn).not.toHaveBeenCalled();
  });
  it("blocks every mutation when a complete listing still holds objects, without logging their keys", async () => {
    const dependencies = setup({ success: true, result: [{ key: "private-key-not-for-logs" }], result_info: { is_truncated: false } });
    const refusal = destroyEnvironment(context, dependencies);
    await expect(refusal).rejects.toThrow("R2 bucket is nonempty or emptiness could not be verified");
    await expect(refusal).rejects.not.toThrow("private-key-not-for-logs");
    for (const fn of Object.values(dependencies)) expect(fn).not.toHaveBeenCalled();
  });
  it.each([200, 401, 403, 500, 404])("does not treat HTTP %i with success false as verified empty or missing", async status => {
    const dependencies = setup({ success: false, errors: [{ code: 9999 }] }, status);
    await expect(destroyEnvironment(context, dependencies)).rejects.toThrow("Failed to safely delete R2 bucket");
    for (const fn of Object.values(dependencies)) expect(fn).not.toHaveBeenCalled();
  });
  it.each([
    ["the observed empty listing without result_info", 200, observedEmptyListing],
    ["an empty listing without is_truncated", 200, { ...observedEmptyListing, result_info: {} }],
    ["an empty listing with explicit metadata", 200, { success: true, result: [], result_info: { is_truncated: false, cursor: "", delimited: [] } }],
    ["a bucket-not-found 404", 404, { success: false, errors: [{ code: 10006 }] }],
  ])("tears the whole stack down, R2 first, for %s", async (_shape, status, payload) => {
    const dependencies = setup(payload, status);
    const order = [];
    for (const name of mutators) dependencies[name].mockImplementation(async () => { order.push(name); return true; });
    await expect(destroyEnvironment(context, dependencies)).resolves.toMatchObject({ bucketObjectsDeleted: 0 });
    expect(order).toEqual(mutators);
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
