import { describe, expect, it } from "vitest";
import {
  ADMIN_MUTATION_ORIGIN_ERROR,
  enforceAdminMutationOrigin,
  hasMatchingRequestOrigin,
  requiresAdminMutationOrigin,
} from "./mutation-security";

const request = (
  method: string,
  origin?: string,
  url = "https://admin.example.com/admin/programs"
) =>
  new Request(url, {
    method,
    headers: origin ? { Origin: origin } : undefined,
  });

describe("admin mutation origin policy", () => {
  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "requires an Origin for %s requests under admin routes",
    (method) => {
      expect(requiresAdminMutationOrigin(method, "/admin/programs")).toBe(true);
      expect(requiresAdminMutationOrigin(method, "/api/admin/import")).toBe(true);
    }
  );

  it("leaves safe methods and non-admin routes unchanged", () => {
    expect(requiresAdminMutationOrigin("GET", "/admin/programs")).toBe(false);
    expect(requiresAdminMutationOrigin("HEAD", "/api/admin/import")).toBe(false);
    expect(requiresAdminMutationOrigin("POST", "/api/portfolio/repos")).toBe(false);
    expect(requiresAdminMutationOrigin("POST", "/administrator")).toBe(false);
  });

  it("accepts same-origin browser mutations, including normalized default ports", () => {
    expect(
      hasMatchingRequestOrigin(
        request("POST", "https://admin.example.com:443")
      )
    ).toBe(true);
    expect(
      enforceAdminMutationOrigin(
        request("POST", "https://admin.example.com")
      )
    ).toBeNull();
  });

  it.each([
    ["missing", undefined],
    ["foreign", "https://attacker.example"],
    ["malformed", "not an origin"],
    ["opaque", "null"],
    ["path-bearing", "https://admin.example.com/not-an-origin"],
    ["credential-bearing", "https://user@admin.example.com"],
  ])("returns a clear 403 for a %s Origin", async (_label, origin) => {
    const response = enforceAdminMutationOrigin(request("POST", origin));

    expect(response?.status).toBe(403);
    await expect(response?.text()).resolves.toBe(ADMIN_MUTATION_ORIGIN_ERROR);
    expect(response?.headers.get("Cache-Control")).toBe("no-store");
  });
});
