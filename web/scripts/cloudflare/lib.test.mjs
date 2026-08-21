import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGeneratedWranglerConfig,
  deleteAiGatewayByName,
  deleteContainerAppByName,
  deleteQueueByName,
  deleteVectorizeIndexByName,
  deriveAgentEnvironmentName,
  deriveEnvironmentContext,
  ensureAiGateway,
  findD1DatabaseByName,
  getSecretBindings,
  queryD1Database,
  removeQueueWorkerConsumer,
  resolveDeploymentMetadata,
} from "./lib.mjs";

beforeEach(() => {
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acc-123");
  vi.stubEnv("CLOUDFLARE_API_TOKEN", "cf-token");
  vi.stubEnv("CLOUDFLARE_ENVIRONMENT_NAME", "staging");
  vi.stubEnv("BETTER_AUTH_SECRET", "better-auth-secret");
  vi.stubEnv("GITHUB_CLIENT_ID", "gh-id");
  vi.stubEnv("GITHUB_CLIENT_SECRET", "gh-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("deriveEnvironmentContext", () => {
  it("derives an AI gateway name alongside other resources", () => {
    const context = deriveEnvironmentContext();
    expect(context.aiGatewayName).toBe("ttv-website-ai-staging");
  });

  it("derives the container application name from the worker name", () => {
    const context = deriveEnvironmentContext();
    expect(context.containerAppName).toBe(
      "ttv-website-staging-ffmpegcontainer"
    );
  });

  it("produces the correct container app name for agent-pr-72", () => {
    vi.stubEnv("CLOUDFLARE_ENVIRONMENT_NAME", "agent-pr-72");
    const context = deriveEnvironmentContext();
    expect(context.workerName).toBe("ttv-website-agent-pr-72");
    expect(context.containerAppName).toBe(
      "ttv-website-agent-pr-72-ffmpegcontainer"
    );
  });

  it("truncates overlong container app names consistently", () => {
    vi.stubEnv("CLOUDFLARE_ENVIRONMENT_NAME", "agent-" + "x".repeat(60));
    const context = deriveEnvironmentContext();
    expect(context.containerAppName.length).toBeLessThanOrEqual(63);
    expect(context.containerAppName).toBe(
      context.workerName.length + 1 + "ffmpegcontainer".length > 63
        ? `${context.workerName}-ffmpegcontainer`.slice(0, 63)
        : `${context.workerName}-ffmpegcontainer`
    );
  });
});

describe("deriveAgentEnvironmentName", () => {
  it("derives a stable, isolated name from the SAM task", () => {
    expect(
      deriveAgentEnvironmentName({
        SAM_TASK_ID: "01KXH3N3SGB464KS2P2H14537E",
      })
    ).toBe("agent-ks2p2h14537e");
  });

  it("falls back to the workspace identity", () => {
    expect(
      deriveAgentEnvironmentName({
        SAM_WORKSPACE_ID: "01KXH3N61664JNFQ225YJ8DFPS",
      })
    ).toBe("agent-fq225yj8dfps");
  });

  it("accepts only explicitly agent-prefixed overrides", () => {
    expect(
      deriveAgentEnvironmentName({
        CLOUDFLARE_ENVIRONMENT_NAME: "Agent Feature 42",
      })
    ).toBe("agent-feature-42");
    expect(() =>
      deriveAgentEnvironmentName({
        CLOUDFLARE_ENVIRONMENT_NAME: "staging",
      })
    ).toThrow('must start with "agent-"');
  });

  it("fails without a SAM identity or explicit name", () => {
    expect(() => deriveAgentEnvironmentName({})).toThrow(
      "Unable to derive an agent environment"
    );
  });
});

describe("resolveDeploymentMetadata", () => {
  it("prefers an explicit version for direct agent deploys", () => {
    expect(
      resolveDeploymentMetadata({
        CLOUDFLARE_ENVIRONMENT_NAME: "agent-123",
        CLOUDFLARE_DEPLOYMENT_VERSION: "deadbeef",
        GITHUB_SHA: "ignored",
      })
    ).toEqual({ environment: "agent-123", version: "deadbeef" });
  });

  it("uses GitHub and SAM identifiers as fallbacks", () => {
    expect(
      resolveDeploymentMetadata({
        CLOUDFLARE_ENVIRONMENT_NAME: "staging",
        GITHUB_SHA: "github-sha",
      })
    ).toEqual({ environment: "staging", version: "github-sha" });
    expect(
      resolveDeploymentMetadata({
        CLOUDFLARE_ENVIRONMENT_NAME: "agent-123",
        SAM_TASK_ID: "task-id",
      })
    ).toEqual({ environment: "agent-123", version: "task-id" });
  });
});

describe("createGeneratedWranglerConfig", () => {
  it("includes deployment identity and every runtime binding", () => {
    vi.stubEnv("CLOUDFLARE_DEPLOYMENT_VERSION", "deadbeef");
    vi.stubEnv("CLOUDFLARE_AGENT_AUTH_ENABLED", "true");
    const config = createGeneratedWranglerConfig({
      workerName: "ttv-agent",
      containerAppName: "ttv-agent-ffmpegcontainer",
      d1Name: "ttv-db-agent",
      d1Id: "db-id",
      bucketName: "ttv-files-agent",
      queueName: "ttv-queue-agent",
      vectorizeIndexName: "ttv-vector-agent",
      aiGatewayName: "ttv-ai-agent",
      betterAuthUrl: "https://ttv-agent.example.workers.dev",
    });

    expect(config.images).toEqual({ binding: "IMAGES" });
    expect(config.observability).toEqual({
      enabled: true,
      head_sampling_rate: 0.1,
    });
    expect(config.workers_dev).toBe(true);
    expect(config.preview_urls).toBe(true);
    expect(config.vars).toMatchObject({
      DEPLOYMENT_ENVIRONMENT: "staging",
      DEPLOYMENT_VERSION: "deadbeef",
      AGENT_AUTH_ENABLED: "true",
    });
    expect(config.d1_databases[0].binding).toBe("DB");
    expect(config.r2_buckets[0].binding).toBe("BUCKET");
    expect(config.ai.binding).toBe("AI");
    expect(config.vectorize[0].binding).toBe("VECTORIZE");
    expect(config.queues.producers[0].binding).toBe("RECORDING_QUEUE");
    expect(config.durable_objects.bindings[0].name).toBe("FFMPEG_CONTAINER");
    expect(config.containers[0].name).toBe("ttv-agent-ffmpegcontainer");
    expect(config.containers[0].instance_type).toBe("standard-2");
  });

  it("keeps agent bearer auth disabled unless it is explicitly enabled", () => {
    const config = createGeneratedWranglerConfig({
      workerName: "ttv-production",
      containerAppName: "ttv-production-ffmpegcontainer",
      d1Name: "ttv-db-production",
      d1Id: "db-id",
      bucketName: "ttv-files-production",
      queueName: "ttv-queue-production",
      vectorizeIndexName: "ttv-vector-production",
      aiGatewayName: "ttv-ai-production",
      betterAuthUrl: "https://example.com",
    });

    expect(config.vars).not.toHaveProperty("AGENT_AUTH_ENABLED");
  });

  it("lets Wrangler disable workers.dev and preview routes for custom domains", () => {
    const config = createGeneratedWranglerConfig({
      workerName: "ttv-production",
      containerAppName: "ttv-production-ffmpegcontainer",
      d1Name: "ttv-db-production",
      d1Id: "db-id",
      bucketName: "ttv-files-production",
      queueName: "ttv-queue-production",
      vectorizeIndexName: "ttv-vector-production",
      aiGatewayName: "ttv-ai-production",
      primaryDomain: "example.com",
      betterAuthUrl: "https://example.com",
    });

    expect(config.workers_dev).toBe(false);
    expect(config.preview_urls).toBe(false);
  });

  it("captures every invocation for isolated preview iteration", () => {
    vi.stubEnv("CLOUDFLARE_ENVIRONMENT_NAME", "agent-pr-55");
    const config = createGeneratedWranglerConfig({
      workerName: "ttv-agent",
      containerAppName: "ttv-agent-ffmpegcontainer",
      d1Name: "ttv-db-agent",
      d1Id: "db-id",
      bucketName: "ttv-files-agent",
      queueName: "ttv-queue-agent",
      vectorizeIndexName: "ttv-vector-agent",
      aiGatewayName: "ttv-ai-agent",
      betterAuthUrl: "https://example.com",
    });

    expect(config.observability).toEqual({
      enabled: true,
      head_sampling_rate: 1,
    });
  });

  it("refuses agent bearer auth outside staging and isolated agent environments", () => {
    vi.stubEnv("CLOUDFLARE_ENVIRONMENT_NAME", "production");
    vi.stubEnv("CLOUDFLARE_AGENT_AUTH_ENABLED", "true");

    expect(() =>
      createGeneratedWranglerConfig({
        workerName: "ttv-production",
        containerAppName: "ttv-production-ffmpegcontainer",
        d1Name: "ttv-db-production",
        d1Id: "db-id",
        bucketName: "ttv-files-production",
        queueName: "ttv-queue-production",
        vectorizeIndexName: "ttv-vector-production",
        aiGatewayName: "ttv-ai-production",
        betterAuthUrl: "https://example.com",
      })
    ).toThrow("allowed only in staging or agent-* environments");
  });

  it("sets explicit container app name so deploy and destroy share one contract", () => {
    vi.stubEnv("CLOUDFLARE_ENVIRONMENT_NAME", "agent-pr-72");
    const context = deriveEnvironmentContext();
    const config = createGeneratedWranglerConfig({
      workerName: context.workerName,
      containerAppName: context.containerAppName,
      d1Name: context.d1Name,
      d1Id: "db-id",
      bucketName: context.bucketName,
      queueName: context.queueName,
      vectorizeIndexName: context.vectorizeIndexName,
      aiGatewayName: context.aiGatewayName,
      betterAuthUrl: "https://example.com",
    });
    expect(config.containers[0].name).toBe(
      "ttv-website-agent-pr-72-ffmpegcontainer"
    );
    expect(config.containers[0].name).toBe(context.containerAppName);
    expect(config.containers[0].instance_type).toBe("standard-2");
  });

  it("deploys and destroys the same truncated name for overlong environments", () => {
    vi.stubEnv("CLOUDFLARE_ENVIRONMENT_NAME", "agent-" + "x".repeat(60));
    const context = deriveEnvironmentContext();
    const config = createGeneratedWranglerConfig({
      workerName: context.workerName,
      containerAppName: context.containerAppName,
      d1Name: context.d1Name,
      d1Id: "db-id",
      bucketName: context.bucketName,
      queueName: context.queueName,
      vectorizeIndexName: context.vectorizeIndexName,
      aiGatewayName: context.aiGatewayName,
      betterAuthUrl: "https://example.com",
    });
    expect(config.containers[0].name).toBe(context.containerAppName);
    expect(config.containers[0].name.length).toBeLessThanOrEqual(63);
  });
});

describe("queryD1Database", () => {
  it("uses the parameterized D1 query API", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, result: [{ results: [] }] }), {
        status: 200,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      queryD1Database("db/id", "SELECT * FROM user WHERE id = ?", ["user-1"])
    ).resolves.toEqual([{ results: [] }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acc-123/d1/database/db%2Fid/query"
    );
    expect(JSON.parse(init.body)).toEqual({
      sql: "SELECT * FROM user WHERE id = ?",
      params: ["user-1"],
    });
  });
});

describe("findD1DatabaseByName", () => {
  it("returns only an exact existing database without creating resources", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          result: [
            { uuid: "wrong-id", name: "ttv-website-db-production-copy" },
            { uuid: "database-id", name: "ttv-website-db-production" },
          ],
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      findD1DatabaseByName("ttv-website-db-production")
    ).resolves.toEqual({
      uuid: "database-id",
      name: "ttv-website-db-production",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][1]?.method).toBe("GET");
  });
});

describe("ensureAiGateway", () => {
  it("returns the existing gateway without creating a new one", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: true, result: { id: "ttv-ai" } }), {
        status: 200,
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await ensureAiGateway("ttv-ai");

    expect(result).toEqual({ id: "ttv-ai" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acc-123/ai-gateway/gateways/ttv-ai"
    );
  });

  it("creates the gateway when it does not exist", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(null, { status: 404 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ success: true, result: { id: "ttv-ai" } }),
          { status: 200 }
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await ensureAiGateway("ttv-ai");

    expect(result).toEqual({ id: "ttv-ai" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [createUrl, createInit] = fetchMock.mock.calls[1];
    expect(createUrl).toBe(
      "https://api.cloudflare.com/client/v4/accounts/acc-123/ai-gateway/gateways"
    );
    expect(createInit.method).toBe("POST");
    expect(JSON.parse(createInit.body)).toMatchObject({
      id: "ttv-ai",
      collect_logs: true,
    });
  });
});

describe("environment cleanup", () => {
  it("deletes an existing AI gateway", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(deleteAiGatewayByName("ttv-ai")).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.cloudflare.com/client/v4/accounts/acc-123/ai-gateway/gateways/ttv-ai",
      expect.objectContaining({ method: "DELETE" })
    );
  });

  it("treats a missing AI gateway as already deleted", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 404 }))
    );
    await expect(deleteAiGatewayByName("missing")).resolves.toBe(false);
  });

  it("removes a Worker's Queue consumer binding idempotently", async () => {
    const runner = vi.fn().mockResolvedValue({});
    await expect(
      removeQueueWorkerConsumer(
        "recordings",
        "recording-worker",
        runner
      )
    ).resolves.toBe(true);
    expect(runner).toHaveBeenCalledWith([
      "queues",
      "consumer",
      "worker",
      "remove",
      "recordings",
      "recording-worker",
    ]);

    const missingRunner = vi.fn().mockRejectedValue(new Error("not found"));
    await expect(
      removeQueueWorkerConsumer("missing", "worker", missingRunner)
    ).resolves.toBe(false);
  });

  it("recognizes Wrangler's exact queue consumer missing error", async () => {
    const wranglerRunner = vi.fn().mockRejectedValue(
      new Error(
        "npx wrangler queues consumer worker remove q w failed with exit code 1\n" +
          "No worker consumer 'w' exists for queue q"
      )
    );
    await expect(
      removeQueueWorkerConsumer("q", "w", wranglerRunner)
    ).resolves.toBe(false);

    const unauthorizedRunner = vi
      .fn()
      .mockRejectedValue(new Error("Unauthorized"));
    await expect(
      removeQueueWorkerConsumer("q", "w", unauthorizedRunner)
    ).rejects.toThrow("Unauthorized");

    const networkRunner = vi
      .fn()
      .mockRejectedValue(new Error("ECONNREFUSED"));
    await expect(
      removeQueueWorkerConsumer("q", "w", networkRunner)
    ).rejects.toThrow("ECONNREFUSED");

    const otherNoExistsRunner = vi
      .fn()
      .mockRejectedValue(new Error("No producer exists for queue recordings"));
    await expect(
      removeQueueWorkerConsumer("recordings", "w", otherNoExistsRunner)
    ).rejects.toThrow("No producer exists");
  });

  it("deletes an existing queue without masking missing queues", async () => {
    const runner = vi.fn().mockResolvedValue({});
    await expect(deleteQueueByName("recordings", runner)).resolves.toBe(true);
    expect(runner.mock.calls).toEqual([
      [["queues", "info", "recordings"]],
      [["queues", "delete", "recordings"]],
    ]);

    const missingRunner = vi.fn().mockRejectedValue(new Error("not found"));
    await expect(deleteQueueByName("missing", missingRunner)).resolves.toBe(false);
    expect(missingRunner).toHaveBeenCalledTimes(1);

    const unauthorizedRunner = vi
      .fn()
      .mockRejectedValue(new Error("Unauthorized"));
    await expect(
      deleteQueueByName("recordings", unauthorizedRunner)
    ).rejects.toThrow("Unauthorized");
  });

  it("force-deletes an existing Vectorize index", async () => {
    const runner = vi.fn().mockResolvedValue({});
    await expect(
      deleteVectorizeIndexByName("transcripts", runner)
    ).resolves.toBe(true);
    expect(runner.mock.calls).toEqual([
      [["vectorize", "get", "transcripts"]],
      [["vectorize", "delete", "transcripts", "--force"]],
    ]);

    const missingRunner = vi
      .fn()
      .mockRejectedValue(new Error("Index does not exist"));
    await expect(
      deleteVectorizeIndexByName("missing", missingRunner)
    ).resolves.toBe(false);
  });

  it("deletes an exact-match container app by UUID", async () => {
    const validUuid = "a1b2c3d4-e5f6-7890-abcd-ef1234567890";
    const runner = vi
      .fn()
      .mockResolvedValueOnce({
        stdout: JSON.stringify([
          { id: validUuid, name: "ttv-website-staging-ffmpegcontainer" },
          { id: "f1e2d3c4-b5a6-7890-abcd-ef1234567890", name: "other-app-ffmpegcontainer" },
        ]),
      })
      .mockResolvedValueOnce({});

    await expect(
      deleteContainerAppByName("ttv-website-staging-ffmpegcontainer", runner)
    ).resolves.toBe(true);
    expect(runner.mock.calls).toEqual([
      [["containers", "list", "--json"]],
      [["containers", "delete", validUuid]],
    ]);
  });

  it("treats no exact container match as already absent", async () => {
    const runner = vi.fn().mockResolvedValueOnce({
      stdout: JSON.stringify([
        { id: "uuid-1", name: "other-app-ffmpegcontainer" },
      ]),
    });

    await expect(
      deleteContainerAppByName("ttv-website-staging-ffmpegcontainer", runner)
    ).resolves.toBe(false);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("treats an empty container list as already absent", async () => {
    const runner = vi.fn().mockResolvedValueOnce({ stdout: "[]" });

    await expect(
      deleteContainerAppByName("missing-app", runner)
    ).resolves.toBe(false);
  });

  it("rejects malformed JSON from the container list", async () => {
    const runner = vi.fn().mockResolvedValueOnce({
      stdout: "not json at all",
    });

    await expect(
      deleteContainerAppByName("any-app", runner)
    ).rejects.toThrow("Failed to parse container list output as JSON");
  });

  it("rejects a non-array container list response", async () => {
    const runner = vi.fn().mockResolvedValueOnce({
      stdout: JSON.stringify({ id: "uuid-1", name: "app" }),
    });

    await expect(
      deleteContainerAppByName("app", runner)
    ).rejects.toThrow("Expected container list to be an array");
  });

  it("never uses substring or prefix matching for container deletion", async () => {
    const runner = vi.fn().mockResolvedValueOnce({
      stdout: JSON.stringify([
        { id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890", name: "ttv-website-agent-pr-72-ffmpegcontainer-extra" },
        { id: "f1e2d3c4-b5a6-7890-abcd-ef1234567890", name: "x-ttv-website-agent-pr-72-ffmpegcontainer" },
      ]),
    });

    await expect(
      deleteContainerAppByName(
        "ttv-website-agent-pr-72-ffmpegcontainer",
        runner
      )
    ).resolves.toBe(false);
    expect(runner).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-UUID container id before calling delete", async () => {
    const malformedRunner = vi.fn().mockResolvedValueOnce({
      stdout: JSON.stringify([
        { id: "not-a-uuid", name: "target-app" },
      ]),
    });
    await expect(
      deleteContainerAppByName("target-app", malformedRunner)
    ).rejects.toThrow('has invalid id: "not-a-uuid"');
    expect(malformedRunner).toHaveBeenCalledTimes(1);

    const numericRunner = vi.fn().mockResolvedValueOnce({
      stdout: JSON.stringify([{ id: 12345, name: "target-app" }]),
    });
    await expect(
      deleteContainerAppByName("target-app", numericRunner)
    ).rejects.toThrow("has invalid id: 12345");
    expect(numericRunner).toHaveBeenCalledTimes(1);

    const nullRunner = vi.fn().mockResolvedValueOnce({
      stdout: JSON.stringify([{ id: null, name: "target-app" }]),
    });
    await expect(
      deleteContainerAppByName("target-app", nullRunner)
    ).rejects.toThrow("has invalid id: null");
    expect(nullRunner).toHaveBeenCalledTimes(1);
  });
});

describe("getSecretBindings", () => {
  it("preserves the existing shared-environment auth secret fallback", () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    const binding = getSecretBindings().find(
      ({ key }) => key === "BETTER_AUTH_SECRET"
    );
    expect(binding?.value).toHaveLength(64);
  });

  it("omits optional keys when no tokens are configured", () => {
    const keys = getSecretBindings().map((binding) => binding.key);
    expect(keys).toEqual([
      "BETTER_AUTH_SECRET",
      "GITHUB_CLIENT_ID",
      "GITHUB_CLIENT_SECRET",
    ]);
  });

  it("includes AI_GATEWAY_API_KEY when CLOUDFLARE_AI_GATEWAY_TOKEN is set", () => {
    vi.stubEnv("CLOUDFLARE_AI_GATEWAY_TOKEN", "scoped-ai-token");
    const bindings = getSecretBindings();
    expect(bindings).toContainEqual({
      key: "AI_GATEWAY_API_KEY",
      value: "scoped-ai-token",
    });
  });

  it("includes CREDENTIALS_ENCRYPTION_KEY when the env var is set", () => {
    vi.stubEnv("CREDENTIALS_ENCRYPTION_KEY", "test-credential-key-base64==");
    const bindings = getSecretBindings();
    expect(bindings).toContainEqual({
      key: "CREDENTIALS_ENCRYPTION_KEY",
      value: "test-credential-key-base64==",
    });
  });

  it("derives a unique credential key for agent preview environments", () => {
    vi.stubEnv("CLOUDFLARE_ENVIRONMENT_NAME", "agent-pr-55");
    vi.stubEnv("AGENT_PREVIEW_SECRET", "p".repeat(32));
    const bindings = getSecretBindings();
    const credBinding = bindings.find(
      ({ key }) => key === "CREDENTIALS_ENCRYPTION_KEY"
    );
    expect(credBinding).toBeDefined();
    const authBinding = bindings.find(
      ({ key }) => key === "BETTER_AUTH_SECRET"
    );
    expect(credBinding?.value).not.toBe(authBinding?.value);
  });

  it("uses preview-only derived auth and disables OAuth in agent environments", () => {
    vi.stubEnv("CLOUDFLARE_ENVIRONMENT_NAME", "agent-pr-55");
    vi.stubEnv("AGENT_PREVIEW_SECRET", "p".repeat(32));
    vi.stubEnv("BETTER_AUTH_SECRET", "shared-secret-must-not-be-used");
    vi.stubEnv("GITHUB_CLIENT_ID", "real-client-must-not-be-used");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "real-secret-must-not-be-used");

    const bindings = getSecretBindings();
    expect(bindings).toContainEqual({
      key: "GITHUB_CLIENT_ID",
      value: "agent-preview-oauth-disabled",
    });
    expect(bindings).toContainEqual({
      key: "GITHUB_CLIENT_SECRET",
      value: "agent-preview-oauth-disabled",
    });
    expect(
      bindings.find(({ key }) => key === "BETTER_AUTH_SECRET")?.value
    ).toHaveLength(64);
    expect(JSON.stringify(bindings)).not.toContain(
      "shared-secret-must-not-be-used"
    );
    expect(JSON.stringify(bindings)).not.toContain(
      "real-secret-must-not-be-used"
    );
  });
});
