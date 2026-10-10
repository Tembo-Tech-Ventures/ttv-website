import { afterEach, describe, expect, it, vi } from "vitest";
import {
  destroyEnvironment,
  emptyAgentR2Bucket,
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
});

describe("destroyEnvironment", () => {
  it("empties and deletes R2 before removing the rest of the environment", async () => {
    const order = [];
    const operation = (name) =>
      vi.fn(async () => {
        order.push(name);
        return true;
      });
    const dependencies = {
      emptyBucket: vi.fn(async () => {
        order.push("emptyBucket");
        return { bucketFound: true, objectsDeleted: 3 };
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
      bucketObjectsDeleted: 3,
      bucketDeleted: true,
    });
    expect(order).toEqual([
      "emptyBucket",
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
        emptyBucket: vi
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
      'Failed to empty and delete R2 bucket "ttv-website-files-agent-123". Original error: GET /r2/buckets/example/objects failed: API unavailable'
    );
    expect(deleteContainerApp).not.toHaveBeenCalled();
    expect(deleteWorker).not.toHaveBeenCalled();
  });

  it("does not attempt Worker deletion when Queue consumer removal fails", async () => {
    const deleteWorker = vi.fn();
    await expect(
      destroyEnvironment(context, {
        emptyBucket: vi
          .fn()
          .mockResolvedValue({ bucketFound: true, objectsDeleted: 0 }),
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
    const emptyBucket = vi.fn();
    await expect(
      destroyEnvironment(
        {
          ...context,
          bucketName: "ttv-website-files-production",
          environmentName: "production",
          environmentSlug: "production",
        },
        {
          emptyBucket,
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
    expect(emptyBucket).not.toHaveBeenCalled();
  });
});

describe("emptyAgentR2Bucket", () => {
  it("succeeds when the bucket is already empty", async () => {
    const listObjectsPage = vi.fn().mockResolvedValue({
      objects: [],
      isTruncated: false,
    });
    const deleteObject = vi.fn();

    await expect(
      emptyAgentR2Bucket(context, { listObjectsPage, deleteObject })
    ).resolves.toEqual({ bucketFound: true, objectsDeleted: 0 });
    expect(listObjectsPage).toHaveBeenCalledWith(context.bucketName, undefined);
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("treats a missing bucket as already empty", async () => {
    const deleteObject = vi.fn();
    await expect(
      emptyAgentR2Bucket(context, {
        listObjectsPage: vi.fn().mockResolvedValue(null),
        deleteObject,
      })
    ).resolves.toEqual({ bucketFound: false, objectsDeleted: 0 });
    expect(deleteObject).not.toHaveBeenCalled();
  });

  it("lists and deletes objects across several cursor pages", async () => {
    const listObjectsPage = vi
      .fn()
      .mockResolvedValueOnce({
        objects: [{ key: "avatars/one.png" }, { key: "avatars/two.png" }],
        cursor: "page-2",
        isTruncated: true,
      })
      .mockResolvedValueOnce({
        objects: [{ key: "recordings/three.mp4" }],
        cursor: "page-3",
        isTruncated: true,
      })
      .mockResolvedValueOnce({
        objects: [{ key: "four.txt" }],
        isTruncated: false,
      });
    const deleteObject = vi.fn().mockResolvedValue(true);

    await expect(
      emptyAgentR2Bucket(context, { listObjectsPage, deleteObject })
    ).resolves.toEqual({ bucketFound: true, objectsDeleted: 4 });
    expect(listObjectsPage.mock.calls).toEqual([
      [context.bucketName, undefined],
      [context.bucketName, "page-2"],
      [context.bucketName, "page-3"],
    ]);
    expect(deleteObject.mock.calls).toEqual([
      [context.bucketName, "avatars/one.png"],
      [context.bucketName, "avatars/two.png"],
      [context.bucketName, "recordings/three.mp4"],
      [context.bucketName, "four.txt"],
    ]);
  });

  it.each(["production", "prod", "staging"])(
    "refuses to empty the %s environment even when protected deletion is overridden",
    async (environmentSlug) => {
      vi.stubEnv("CLOUDFLARE_ALLOW_PROTECTED_DESTROY", "true");
      const listObjectsPage = vi.fn();

      await expect(
        emptyAgentR2Bucket(
          {
            ...context,
            environmentName: environmentSlug,
            environmentSlug,
            bucketName: `ttv-website-files-${environmentSlug}`,
          },
          { listObjectsPage }
        )
      ).rejects.toThrow(
        `Refusing to empty R2 bucket for non-agent environment "${environmentSlug}"`
      );
      expect(listObjectsPage).not.toHaveBeenCalled();
    }
  );

  it("refuses an agent environment whose bucket lacks the exact agent prefix", async () => {
    const listObjectsPage = vi.fn();
    await expect(
      emptyAgentR2Bucket(
        { ...context, bucketName: "ttv-website-files-production" },
        { listObjectsPage }
      )
    ).rejects.toThrow(
      'Refusing to empty R2 bucket "ttv-website-files-production"'
    );
    expect(listObjectsPage).not.toHaveBeenCalled();
  });

  it("rejects malformed or cyclic pagination instead of looping", async () => {
    await expect(
      emptyAgentR2Bucket(context, {
        listObjectsPage: vi.fn().mockResolvedValue({
          objects: [{ key: "one" }],
          isTruncated: true,
        }),
        deleteObject: vi.fn().mockResolvedValue(true),
      })
    ).rejects.toThrow("without a cursor");

    await expect(
      emptyAgentR2Bucket(context, {
        listObjectsPage: vi.fn().mockResolvedValue({
          objects: [],
          cursor: "same-cursor",
          isTruncated: true,
        }),
        deleteObject: vi.fn(),
      })
    ).rejects.toThrow('repeated R2 object-list cursor "same-cursor"');
  });
});
