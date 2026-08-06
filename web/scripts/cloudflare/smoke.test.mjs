import { describe, expect, it, vi } from "vitest";
import { parseSmokeArgs, runSmokeChecks } from "./smoke.mjs";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("parseSmokeArgs", () => {
  it("parses the live verification contract", () => {
    expect(
      parseSmokeArgs([
        "--base-url=https://example.com/",
        "--expected-environment=agent-123",
        "--expected-version=abc123",
      ])
    ).toEqual({
      baseUrl: "https://example.com/",
      expectedEnvironment: "agent-123",
      expectedVersion: "abc123",
    });
  });

  it("requires a base URL", () => {
    expect(() => parseSmokeArgs([])).toThrow("Missing required --base-url");
  });

  it("rejects non-HTTP smoke targets", async () => {
    await expect(
      runSmokeChecks({ baseUrl: "file:///etc/passwd", fetchImpl: vi.fn() })
    ).rejects.toThrow("must use HTTP or HTTPS");
  });
});

describe("runSmokeChecks", () => {
  it("verifies deployment identity and the public homepage", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          status: "ok",
          service: "ttv-website",
          environment: "agent-123",
          version: "abc123",
        })
      )
      .mockResolvedValueOnce(
        new Response("<html></html>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      );

    await expect(
      runSmokeChecks({
        baseUrl: "https://example.com/",
        expectedEnvironment: "agent-123",
        expectedVersion: "abc123",
        fetchImpl: fetchMock,
        requiredConsecutiveSuccesses: 1,
        requiredHomepageConsecutiveSuccesses: 1,
        settleDelayMs: 0,
      })
    ).resolves.toEqual({
      baseUrl: "https://example.com",
      environment: "agent-123",
      version: "abc123",
      checks: ["health", "homepage"],
    });
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://example.com/api/health",
      "https://example.com/",
    ]);
  });

  it("rejects a stale or cross-wired deployment", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        status: "ok",
        service: "ttv-website",
        environment: "staging",
        version: "old-version",
      })
    );

    await expect(
      runSmokeChecks({
        baseUrl: "https://example.com",
        expectedEnvironment: "agent-123",
        expectedVersion: "new-version",
        fetchImpl: fetchMock,
        healthAttempts: 1,
        requiredConsecutiveSuccesses: 1,
        settleDelayMs: 0,
      })
    ).rejects.toThrow('Expected environment "agent-123"');
  });

  it("waits for the expected version to propagate after deployment", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          status: "ok",
          service: "ttv-website",
          environment: "agent-123",
          version: "old-version",
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          status: "ok",
          service: "ttv-website",
          environment: "agent-123",
          version: "new-version",
        })
      )
      .mockResolvedValueOnce(
        new Response("<html></html>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      );
    const sleepMock = vi.fn().mockResolvedValue(undefined);

    await expect(
      runSmokeChecks({
        baseUrl: "https://example.com",
        expectedEnvironment: "agent-123",
        expectedVersion: "new-version",
        fetchImpl: fetchMock,
        healthAttempts: 2,
        retryDelayMs: 1,
        requiredConsecutiveSuccesses: 1,
        requiredHomepageConsecutiveSuccesses: 1,
        settleDelayMs: 0,
        sleepImpl: sleepMock,
      })
    ).resolves.toMatchObject({ version: "new-version" });
    expect(sleepMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://example.com/api/health",
      "https://example.com/api/health",
      "https://example.com/",
    ]);
  });

  it("fails on an unhealthy endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));
    await expect(
      runSmokeChecks({
        baseUrl: "https://example.com",
        fetchImpl: fetchMock,
        healthAttempts: 1,
        requiredConsecutiveSuccesses: 1,
        settleDelayMs: 0,
      })
    ).rejects.toThrow("returned HTTP 503");
  });

  const healthyResponse = () =>
    jsonResponse({
      status: "ok",
      service: "ttv-website",
      environment: "agent-123",
      version: "abc123",
    });

  it("requires sustained stability before declaring the deployment ready", async () => {
    // Propagation flap: two healthy checks, a workers.dev placeholder 404,
    // then three healthy checks — the counter must reset on the flap.
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(healthyResponse())
      .mockResolvedValueOnce(healthyResponse())
      .mockResolvedValueOnce(new Response("nothing here yet", { status: 404 }))
      .mockResolvedValueOnce(healthyResponse())
      .mockResolvedValueOnce(healthyResponse())
      .mockResolvedValueOnce(healthyResponse())
      .mockResolvedValueOnce(
        new Response("<html></html>", {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        })
      );

    await expect(
      runSmokeChecks({
        baseUrl: "https://example.com",
        expectedEnvironment: "agent-123",
        expectedVersion: "abc123",
        fetchImpl: fetchMock,
        healthAttempts: 10,
        retryDelayMs: 1,
        requiredConsecutiveSuccesses: 3,
        requiredHomepageConsecutiveSuccesses: 1,
        settleDelayMs: 0,
        sleepImpl: vi.fn().mockResolvedValue(undefined),
      })
    ).resolves.toMatchObject({ version: "abc123" });
    const healthCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/api/health")
    );
    expect(healthCalls).toHaveLength(6);
  });

  it("fails when stability is never sustained", async () => {
    const fetchMock = vi.fn((url) => {
      if (String(url).endsWith("/api/health")) {
        return fetchMock.mock.calls.length % 2 === 1
          ? Promise.resolve(healthyResponse())
          : Promise.resolve(new Response("nothing here yet", { status: 404 }));
      }
      return Promise.resolve(new Response("<html></html>", { status: 200 }));
    });

    await expect(
      runSmokeChecks({
        baseUrl: "https://example.com",
        expectedEnvironment: "agent-123",
        expectedVersion: "abc123",
        fetchImpl: fetchMock,
        healthAttempts: 4,
        retryDelayMs: 1,
        requiredConsecutiveSuccesses: 3,
        settleDelayMs: 0,
        sleepImpl: vi.fn().mockResolvedValue(undefined),
      })
    ).rejects.toThrow(/never stayed stable|did not become ready/);
  });

  const htmlResponse = (contentType = "text/html; charset=utf-8") =>
    new Response("<html></html>", {
      status: 200,
      headers: { "content-type": contentType },
    });

  it("waits through homepage 404s until HTML is sustained", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(healthyResponse())
      .mockResolvedValueOnce(new Response("nothing here yet", { status: 404 }))
      .mockResolvedValueOnce(htmlResponse())
      .mockResolvedValueOnce(htmlResponse())
      .mockResolvedValueOnce(htmlResponse());
    const sleepMock = vi.fn().mockResolvedValue(undefined);

    await expect(
      runSmokeChecks({
        baseUrl: "https://example.com",
        expectedEnvironment: "agent-123",
        expectedVersion: "abc123",
        fetchImpl: fetchMock,
        requiredConsecutiveSuccesses: 1,
        homepageAttempts: 4,
        homepageRetryDelayMs: 25,
        requiredHomepageConsecutiveSuccesses: 3,
        settleDelayMs: 0,
        sleepImpl: sleepMock,
      })
    ).resolves.toMatchObject({ version: "abc123" });

    const homepageCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/")
    );
    expect(homepageCalls).toHaveLength(4);
    expect(sleepMock).toHaveBeenCalledTimes(3);
    expect(sleepMock).toHaveBeenNthCalledWith(1, 25);
    expect(sleepMock).toHaveBeenNthCalledWith(2, 25);
    expect(sleepMock).toHaveBeenNthCalledWith(3, 25);
  });

  it("resets homepage stability for 404s and non-HTML responses", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(healthyResponse())
      .mockResolvedValueOnce(htmlResponse())
      .mockResolvedValueOnce(new Response("nothing here yet", { status: 404 }))
      .mockResolvedValueOnce(htmlResponse())
      .mockResolvedValueOnce(htmlResponse("application/json"))
      .mockResolvedValueOnce(htmlResponse())
      .mockResolvedValueOnce(htmlResponse());

    await expect(
      runSmokeChecks({
        baseUrl: "https://example.com",
        expectedEnvironment: "agent-123",
        expectedVersion: "abc123",
        fetchImpl: fetchMock,
        requiredConsecutiveSuccesses: 1,
        homepageAttempts: 6,
        homepageRetryDelayMs: 1,
        requiredHomepageConsecutiveSuccesses: 2,
        settleDelayMs: 0,
        sleepImpl: vi.fn().mockResolvedValue(undefined),
      })
    ).resolves.toMatchObject({ version: "abc123" });

    const homepageCalls = fetchMock.mock.calls.filter(([url]) =>
      String(url).endsWith("/")
    );
    expect(homepageCalls).toHaveLength(6);
  });

  it("fails when homepage HTML never stays stable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(healthyResponse())
      .mockResolvedValueOnce(htmlResponse())
      .mockResolvedValueOnce(new Response("nothing here yet", { status: 404 }))
      .mockResolvedValueOnce(htmlResponse())
      .mockResolvedValueOnce(htmlResponse("application/json"));

    await expect(
      runSmokeChecks({
        baseUrl: "https://example.com",
        expectedEnvironment: "agent-123",
        expectedVersion: "abc123",
        fetchImpl: fetchMock,
        requiredConsecutiveSuccesses: 1,
        homepageAttempts: 4,
        homepageRetryDelayMs: 1,
        requiredHomepageConsecutiveSuccesses: 2,
        settleDelayMs: 0,
        sleepImpl: vi.fn().mockResolvedValue(undefined),
      })
    ).rejects.toThrow(
      "Homepage answered with HTML but never stayed stable for 2 consecutive checks within 4 attempts."
    );
  });

  it("settles only after health and homepage stability", async () => {
    const events = [];
    const fetchMock = vi.fn(async (url) => {
      if (String(url).endsWith("/api/health")) {
        events.push("health");
        return healthyResponse();
      }
      events.push("homepage");
      return htmlResponse();
    });
    const sleepMock = vi.fn(async (durationMs) => {
      events.push(`sleep:${durationMs}`);
    });

    await runSmokeChecks({
      baseUrl: "https://example.com",
      expectedEnvironment: "agent-123",
      expectedVersion: "abc123",
      fetchImpl: fetchMock,
      requiredConsecutiveSuccesses: 1,
      homepageAttempts: 2,
      homepageRetryDelayMs: 25,
      requiredHomepageConsecutiveSuccesses: 2,
      settleDelayMs: 7_500,
      sleepImpl: sleepMock,
    });

    expect(events).toEqual([
      "health",
      "homepage",
      "sleep:25",
      "homepage",
      "sleep:7500",
    ]);
  });
});
