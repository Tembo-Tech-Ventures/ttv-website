import { afterEach, describe, expect, it, vi } from "vitest";
import { destroyEnvironment } from "./destroy.mjs";

const context = {
  environmentName: "agent-123",
  environmentSlug: "agent-123",
  workerName: "worker",
  containerAppName: "worker-ffmpegcontainer",
  queueName: "queue",
  vectorizeIndexName: "vector",
  aiGatewayName: "gateway",
  d1Name: "database",
  bucketName: "bucket",
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("destroyEnvironment", () => {
  it("deletes container app after R2 and before Worker/DO removal", async () => {
    const order = [];
    const operation = (name) =>
      vi.fn(async () => {
        order.push(name);
        return true;
      });
    const dependencies = {
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
      bucketDeleted: true,
    });
    expect(order).toEqual([
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

  it("leaves the rest of the environment intact when R2 is not empty", async () => {
    const deleteContainerApp = vi.fn();
    const deleteWorker = vi.fn();
    await expect(
      destroyEnvironment(context, {
        deleteBucket: vi.fn().mockRejectedValue(new Error("bucket not empty")),
        deleteContainerApp,
        deleteWorker,
      })
    ).rejects.toThrow('Failed to delete R2 bucket "bucket"');
    expect(deleteContainerApp).not.toHaveBeenCalled();
    expect(deleteWorker).not.toHaveBeenCalled();
  });

  it("does not attempt Worker deletion when Queue consumer removal fails", async () => {
    const deleteWorker = vi.fn();
    await expect(
      destroyEnvironment(context, {
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
          environmentName: "production",
          environmentSlug: "production",
        },
        { deleteBucket }
      )
    ).rejects.toThrow('Refusing to destroy protected environment "production"');
    expect(deleteBucket).not.toHaveBeenCalled();

    vi.stubEnv("CLOUDFLARE_ALLOW_PROTECTED_DESTROY", "true");
    const operation = vi.fn().mockResolvedValue(true);
    await expect(
      destroyEnvironment(
        {
          ...context,
          environmentName: "production",
          environmentSlug: "production",
        },
        {
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
    ).resolves.toMatchObject({ environment: "production" });
  });
});
