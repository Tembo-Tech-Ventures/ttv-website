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
      })
    ).rejects.toThrow("returned HTTP 503");
  });
});
