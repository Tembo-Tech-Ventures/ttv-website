import { afterEach, describe, expect, it, vi } from "vitest";
import { destroyEnvironment } from "./destroy.mjs";

const context = {
  environmentName: "agent-123",
  environmentSlug: "agent-123",
  workerName: "worker",
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
  it("checks and deletes R2 before deleting the rest of the stack", async () => {
    const order = [];
    const operation = (name) =>
      vi.fn(async () => {
        order.push(name);
        return true;
      });
    const dependencies = {
      deleteBucket: operation("bucket"),
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
      workerDeleted: true,
      queueDeleted: true,
      vectorizeIndexDeleted: true,
      aiGatewayDeleted: true,
      databaseDeleted: true,
      bucketDeleted: true,
    });
    expect(order).toEqual([
      "bucket",
      "worker",
      "queue",
      "vector",
      "gateway",
      "database",
    ]);
  });

  it("leaves the rest of the environment intact when R2 is not empty", async () => {
    const deleteWorker = vi.fn();
    await expect(
      destroyEnvironment(context, {
        deleteBucket: vi.fn().mockRejectedValue(new Error("bucket not empty")),
        deleteWorker,
      })
    ).rejects.toThrow('Failed to delete R2 bucket "bucket"');
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
