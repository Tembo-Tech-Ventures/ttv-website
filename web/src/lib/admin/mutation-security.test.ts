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
        request("POST", "https://admin.example.com"),
        "/admin/programs"
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
    const response = enforceAdminMutationOrigin(
      request("POST", origin),
      "/admin/programs"
    );

    expect(response?.status).toBe(403);
    await expect(response?.text()).resolves.toBe(ADMIN_MUTATION_ORIGIN_ERROR);
    expect(response?.headers.get("Cache-Control")).toBe("no-store");
  });
});

describe("admin mutation guard uses the resolved path", () => {
  // Astro percent-decodes and collapses duplicate slashes before middleware
  // runs, so these all route to an admin page and pass the ADMIN role check.
  // The guard must see the same resolved path, not the raw request URL.
  it.each([
    ["duplicate leading slashes", "https://admin.example.com//admin/users/u1"],
    ["percent-encoded prefix", "https://admin.example.com/%61dmin/users/u1"],
    [
      "encoded api prefix",
      "https://admin.example.com/api/%61dmin/import",
    ],
  ])(
    "still rejects a cross-origin POST disguised by a %s",
    async (_label, rawUrl) => {
      const resolvedPathname = rawUrl.includes("api")
        ? "/api/admin/import"
        : "/admin/users/u1";
      const disguised = new Request(rawUrl, {
        method: "POST",
        headers: { Origin: "https://attacker.example" },
      });

      // The raw path alone would let the request through.
      expect(
        requiresAdminMutationOrigin("POST", new URL(rawUrl).pathname)
      ).toBe(false);

      const response = enforceAdminMutationOrigin(disguised, resolvedPathname);
      expect(response?.status).toBe(403);
      await expect(response?.text()).resolves.toBe(ADMIN_MUTATION_ORIGIN_ERROR);
    }
  );

  it("still allows a same-origin POST on a disguised path", () => {
    const disguised = new Request(
      "https://admin.example.com//admin/users/u1",
      {
        method: "POST",
        headers: { Origin: "https://admin.example.com" },
      }
    );

    expect(
      enforceAdminMutationOrigin(disguised, "/admin/users/u1")
    ).toBeNull();
  });
});
