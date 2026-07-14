import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createGeneratedWranglerConfig,
  deleteAiGatewayByName,
  deleteQueueByName,
  deleteVectorizeIndexByName,
  deriveAgentEnvironmentName,
  deriveEnvironmentContext,
  ensureAiGateway,
  getSecretBindings,
  queryD1Database,
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
  });

  it("keeps agent bearer auth disabled unless it is explicitly enabled", () => {
    const config = createGeneratedWranglerConfig({
      workerName: "ttv-production",
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

  it("captures every invocation for isolated preview iteration", () => {
    vi.stubEnv("CLOUDFLARE_ENVIRONMENT_NAME", "agent-pr-55");
    const config = createGeneratedWranglerConfig({
      workerName: "ttv-agent",
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
});

describe("getSecretBindings", () => {
  it("preserves the existing shared-environment auth secret fallback", () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "");
    const binding = getSecretBindings().find(
      ({ key }) => key === "BETTER_AUTH_SECRET"
    );
    expect(binding?.value).toHaveLength(64);
  });

  it("omits the AI gateway key when no token is configured", () => {
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
