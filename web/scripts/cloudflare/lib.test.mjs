import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  deriveEnvironmentContext,
  ensureAiGateway,
  getSecretBindings,
} from "./lib.mjs";

beforeEach(() => {
  vi.stubEnv("CLOUDFLARE_ACCOUNT_ID", "acc-123");
  vi.stubEnv("CLOUDFLARE_API_TOKEN", "cf-token");
  vi.stubEnv("CLOUDFLARE_ENVIRONMENT_NAME", "staging");
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

describe("getSecretBindings", () => {
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
});
