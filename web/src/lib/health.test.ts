import { describe, expect, it } from "vitest";
import {
  HEALTH_PATH,
  createHealthPayload,
  createHealthResponse,
  isHealthCheckPath,
} from "./health";

describe("health checks", () => {
  it("recognizes only the exact public health path", () => {
    expect(isHealthCheckPath(HEALTH_PATH)).toBe(true);
    expect(isHealthCheckPath(`${HEALTH_PATH}/`)).toBe(false);
    expect(isHealthCheckPath("/api/health-details")).toBe(false);
  });

  it("includes deployment identity in the payload", () => {
    expect(
      createHealthPayload({
        DEPLOYMENT_ENVIRONMENT: "agent-abc123",
        DEPLOYMENT_VERSION: "deadbeef",
      })
    ).toEqual({
      status: "ok",
      service: "ttv-website",
      environment: "agent-abc123",
      version: "deadbeef",
    });
  });

  it("uses explicit unknown values when metadata is unavailable", () => {
    expect(createHealthPayload({})).toMatchObject({
      environment: "unknown",
      version: "unknown",
    });
  });

  it("returns a non-cacheable JSON response", async () => {
    const response = createHealthResponse({
      DEPLOYMENT_ENVIRONMENT: "staging",
      DEPLOYMENT_VERSION: "version-1",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      environment: "staging",
      version: "version-1",
    });
  });
});
