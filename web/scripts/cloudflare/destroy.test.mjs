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

const mutationNames = [
  "deleteBucket",
  "deleteContainerApp",
  "removeQueueConsumer",
  "deleteWorker",
  "deleteQueue",
  "deleteVectorize",
  "deleteAiGateway",
  "deleteDatabase",
];

function mutationDependencies(result = false) {
  return Object.fromEntries(
    mutationNames.map((name) => [name, vi.fn().mockResolvedValue(result)])
  );
}

function expectNoMutations(dependencies) {
  for (const name of mutationNames) {
    expect(dependencies[name]).not.toHaveBeenCalled();
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("destroyEnvironment", () => {
  it("checks and deletes verified-empty R2 before removing the environment", async () => {
    const order = [];
    const operation = (name) =>
      vi.fn(async () => {
        order.push(name);
        return true;
      });
    const dependencies = {
      listObjectsPage: vi.fn(async () => {
        order.push("listObjectsPage");
        return { objects: [], isTruncated: false, delimitedPrefixes: [] };
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

    await expect(destroyEnvironment(context, dependencies)).resolves.toEqual({
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

  it("surfaces an R2 API error and leaves the environment intact", async () => {
    const dependencies = mutationDependencies();
    dependencies.listObjectsPage = vi
      .fn()
      .mockRejectedValue(
        new Error("GET /r2/buckets/example/objects failed: API unavailable")
      );

    await expect(destroyEnvironment(context, dependencies)).rejects.toThrow(
      'Failed to safely delete R2 bucket "ttv-website-files-agent-123". Original error: GET /r2/buckets/example/objects failed: API unavailable'
    );
    expectNoMutations(dependencies);
  });

  it("does not attempt Worker deletion when Queue consumer removal fails", async () => {
    const deleteWorker = vi.fn();
    await expect(
      destroyEnvironment(context, {
        listObjectsPage: vi.fn().mockResolvedValue({
          objects: [],
          isTruncated: false,
          delimitedPrefixes: [],
        }),
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

  it.each(["production", "prod", "staging"])(
    "refuses to destroy protected %s by default",
    async (environmentSlug) => {
      const deleteBucket = vi.fn();
      await expect(
        destroyEnvironment(
          {
            ...context,
            bucketName: `ttv-website-files-${environmentSlug}`,
            environmentName: environmentSlug,
            environmentSlug,
          },
          { deleteBucket }
        )
      ).rejects.toThrow(
        `Refusing to destroy protected environment "${environmentSlug}"`
      );
      expect(deleteBucket).not.toHaveBeenCalled();
    }
  );

  it("cannot remove built-in protected environments through configuration", async () => {
    vi.stubEnv("CLOUDFLARE_PROTECTED_ENVIRONMENTS", "custom-preview");
    const deleteBucket = vi.fn();

    await expect(
      destroyEnvironment(
        {
          ...context,
          bucketName: "ttv-website-files-staging",
          environmentName: "staging",
          environmentSlug: "staging",
        },
        { deleteBucket }
      )
    ).rejects.toThrow('Refusing to destroy protected environment "staging"');
    expect(deleteBucket).not.toHaveBeenCalled();
  });

  it("never runs agent R2 preflight for an explicitly overridden protected environment", async () => {
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
  it("follows empty cursor pages until listing completion is verified", async () => {
    const listObjectsPage = vi
      .fn()
      .mockResolvedValueOnce({
        objects: [],
        cursor: "page-2",
        isTruncated: true,
        delimitedPrefixes: [],
      })
      .mockResolvedValueOnce({
        objects: [],
        isTruncated: false,
        delimitedPrefixes: [],
      });

    await expect(
      ensureAgentR2BucketEmpty(context, { listObjectsPage })
    ).resolves.toBeUndefined();
    expect(listObjectsPage.mock.calls).toEqual([
      [context.bucketName, undefined, { requireCompleteMetadata: true }],
      [context.bucketName, "page-2", { requireCompleteMetadata: true }],
    ]);
  });

  it("allows idempotent teardown after the bucket is already absent", async () => {
    const dependencies = mutationDependencies();
    dependencies.listObjectsPage = vi.fn().mockResolvedValue(null);

    await expect(destroyEnvironment(context, dependencies)).resolves.toMatchObject(
      {
        bucketObjectsDeleted: 0,
        bucketDeleted: false,
      }
    );
    for (const name of mutationNames) {
      expect(dependencies[name]).toHaveBeenCalledTimes(1);
    }
  });

  it.each([
    { objects: [{ key: "private-key-not-for-logs" }], isTruncated: false },
    { objects: [], isTruncated: true },
    { objects: [], isTruncated: false, cursor: "unexpected" },
    { objects: [] },
    { objects: null, isTruncated: false },
    { objects: [], isTruncated: false, delimitedPrefixes: ["hidden/"] },
    undefined,
  ])(
    "preserves every resource for a nonempty or uncertain listing %j",
    async (page) => {
      const dependencies = mutationDependencies();
      dependencies.listObjectsPage = vi.fn().mockResolvedValue(page);

      await expect(destroyEnvironment(context, dependencies)).rejects.toThrow(
        "Preserve the environment for review"
      );
      expectNoMutations(dependencies);
    }
  );

  it("rejects repeated pagination cursors instead of looping", async () => {
    const dependencies = mutationDependencies();
    dependencies.listObjectsPage = vi.fn().mockResolvedValue({
      objects: [],
      cursor: "same-cursor",
      isTruncated: true,
      delimitedPrefixes: [],
    });

    await expect(destroyEnvironment(context, dependencies)).rejects.toThrow(
      "Preserve the environment for review"
    );
    expect(dependencies.listObjectsPage).toHaveBeenCalledTimes(2);
    expectNoMutations(dependencies);
  });

  it("does not reveal object keys in the refusal", async () => {
    const privateKey = "private-key-not-for-logs";
    let error;
    try {
      await ensureAgentR2BucketEmpty(context, {
        listObjectsPage: vi.fn().mockResolvedValue({
          objects: [{ key: privateKey }],
          isTruncated: false,
          delimitedPrefixes: [],
        }),
      });
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(Error);
    expect(error.message).not.toContain(privateKey);
  });

  it("stops further deletion if an object arrives after the empty check", async () => {
    const dependencies = mutationDependencies();
    dependencies.listObjectsPage = vi.fn().mockResolvedValue({
      objects: [],
      isTruncated: false,
      delimitedPrefixes: [],
    });
    dependencies.deleteBucket.mockRejectedValue(new Error("Bucket is not empty"));

    await expect(destroyEnvironment(context, dependencies)).rejects.toThrow(
      "Bucket is not empty"
    );
    expect(dependencies.deleteBucket).toHaveBeenCalledTimes(1);
    for (const operationName of mutationNames.filter(
      (candidate) => candidate !== "deleteBucket"
    )) {
      expect(dependencies[operationName]).not.toHaveBeenCalled();
    }
  });

  it.each(["production", "prod", "staging"])(
    "refuses agent preflight for %s even with protected deletion overridden",
    async (environmentSlug) => {
      vi.stubEnv("CLOUDFLARE_ALLOW_PROTECTED_DESTROY", "true");
      const listObjectsPage = vi.fn();

      await expect(
        ensureAgentR2BucketEmpty(
          { ...context, environmentSlug },
          { listObjectsPage }
        )
      ).rejects.toThrow("non-agent environment");
      expect(listObjectsPage).not.toHaveBeenCalled();
    }
  );

  it.each([
    "ttv-website-files-production",
    "ttv-website-files-agent-other",
  ])("rejects mismatched bucket %s before mutation", async (bucketName) => {
    const dependencies = mutationDependencies();
    dependencies.listObjectsPage = vi.fn();

    await expect(
      destroyEnvironment({ ...context, bucketName }, dependencies)
    ).rejects.toThrow("Expected an exact");
    expectNoMutations(dependencies);
    expect(dependencies.listObjectsPage).not.toHaveBeenCalled();
  });
});

describe("real R2 adapter teardown boundary", () => {
  function setupFetch(responses) {
    vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "fictional-account");
    vi.stubEnv("CLOUDFLARE_API_TOKEN", "fictional-test-token");
    const fetchMock = vi.fn();
    for (const response of responses) {
      fetchMock.mockResolvedValueOnce(response);
    }
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it.each([
    {
      success: true,
      result: [],
      result_info: { is_truncated: false, cursor: "", delimited: [] },
    },
    {
      success: true,
      result: [],
      result_info: { count: 0, per_page: 1000 },
    },
  ])("accepts a supported complete empty listing %#", async (payload) => {
    setupFetch([Response.json(payload)]);
    const dependencies = mutationDependencies(true);

    await expect(destroyEnvironment(context, dependencies)).resolves.toMatchObject(
      {
        bucketObjectsDeleted: 0,
        bucketDeleted: true,
      }
    );
    for (const name of mutationNames) {
      expect(dependencies[name]).toHaveBeenCalledTimes(1);
    }
  });

  it("follows the standard cursor response shape to a complete empty page", async () => {
    const fetchMock = setupFetch([
      Response.json({
        success: true,
        result: [],
        result_info: { count: 0, cursor: "next/page", per_page: 1000 },
      }),
      Response.json({
        success: true,
        result: [],
        result_info: { count: 0, per_page: 1000 },
      }),
    ]);
    const dependencies = mutationDependencies(true);

    await expect(destroyEnvironment(context, dependencies)).resolves.toMatchObject(
      { bucketDeleted: true }
    );
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api.cloudflare.com/client/v4/accounts/fictional-account/r2/buckets/ttv-website-files-agent-123/objects?per_page=1000",
      "https://api.cloudflare.com/client/v4/accounts/fictional-account/r2/buckets/ttv-website-files-agent-123/objects?per_page=1000&cursor=next%2Fpage",
    ]);
  });

  it.each([
    { success: true, result: [] },
    { success: true, result: [], result_info: null },
    { success: true, result: [], result_info: {} },
    { success: true, result: [], result_info: { is_truncated: "false" } },
    { success: true, result: [], result_info: { is_truncated: true } },
    {
      success: true,
      result: [],
      result_info: { is_truncated: false, cursor: "unexpected" },
    },
    { success: true, result: [], result_info: { cursor: 42 } },
    { success: true, result: [], result_info: { count: "0" } },
    { success: true, result: [], result_info: { per_page: 0 } },
    { success: true, result: [], result_info: { delimited: "hidden/" } },
    { result: [], result_info: {} },
  ])("preserves the environment for ambiguous raw metadata %#", async (payload) => {
    setupFetch([Response.json(payload)]);
    const dependencies = mutationDependencies();

    await expect(destroyEnvironment(context, dependencies)).rejects.toThrow(
      "R2 listing completion metadata could not be verified"
    );
    expectNoMutations(dependencies);
  });

  it("preserves a nonempty bucket without exposing its object key", async () => {
    const privateKey = "private-key-not-for-logs";
    setupFetch([
      Response.json({
        success: true,
        result: [{ key: privateKey }],
        result_info: { count: 1, per_page: 1000 },
      }),
    ]);
    const dependencies = mutationDependencies();

    let error;
    try {
      await destroyEnvironment(context, dependencies);
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toContain("Preserve the environment for review");
    expect(error.message).not.toContain(privateKey);
    expectNoMutations(dependencies);
  });

  it("accepts only the verified R2 bucket-not-found code as already absent", async () => {
    setupFetch([
      Response.json(
        { success: false, errors: [{ code: 10006 }] },
        { status: 404 }
      ),
    ]);
    const dependencies = mutationDependencies();

    await expect(destroyEnvironment(context, dependencies)).resolves.toMatchObject(
      { bucketDeleted: false }
    );
    for (const name of mutationNames) {
      expect(dependencies[name]).toHaveBeenCalledTimes(1);
    }
  });

  it.each([401, 403, 500, 404])(
    "does not treat HTTP %i as a verified missing bucket",
    async (status) => {
      setupFetch([
        Response.json(
          { success: false, errors: [{ code: 9999, message: "failure" }] },
          { status }
        ),
      ]);
      const dependencies = mutationDependencies();

      await expect(destroyEnvironment(context, dependencies)).rejects.toThrow(
        "Failed to safely delete R2 bucket"
      );
      expectNoMutations(dependencies);
    }
  );
});
