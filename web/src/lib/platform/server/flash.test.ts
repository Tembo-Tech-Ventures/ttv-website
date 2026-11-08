import type { AstroCookies } from "astro";
import { describe, expect, it } from "vitest";
import { redirectWithFlash, takeFlash } from "./flash";

/** Enough of AstroCookies to watch what the helpers do. */
function jar(initial?: string) {
  const writes: Array<{ name: string; value: string; options: unknown }> = [];
  const deletes: Array<{ name: string; options: unknown }> = [];
  const cookies = {
    get: (name: string) => (name === "ttv-flash" && initial !== undefined ? { value: initial } : undefined),
    set: (name: string, value: string, options: unknown) => writes.push({ name, value, options }),
    delete: (name: string, options: unknown) => deletes.push({ name, options }),
  } as unknown as AstroCookies;
  return { cookies, writes, deletes };
}

const url = new URL("http://127.0.0.1:4321/admin/users/u1?tab=roles");

describe("redirectWithFlash", () => {
  it("keeps the target's query and hash, and drops Secure on plain http", () => {
    const { cookies, writes } = jar();
    const response = redirectWithFlash({ cookies, url }, "/admin/users/u1?tab=roles#roles", { tone: "success", title: "Roles saved" });
    expect(response.headers.get("location")).toBe("/admin/users/u1?tab=roles#roles");
    expect(writes[0].options).toMatchObject({ path: "/admin/users/u1", secure: false, httpOnly: true });
  });

  it("refuses another site and an empty message", () => {
    const { cookies } = jar();
    expect(() => redirectWithFlash({ cookies, url }, "https://evil.invalid/x", { tone: "info", title: "Hi" })).toThrow(/this site/);
    expect(() => redirectWithFlash({ cookies, url }, "/admin", { tone: "info" })).toThrow(/title or a message/);
  });
});

describe("takeFlash", () => {
  it("returns nothing and touches nothing when no flash waits", () => {
    const { cookies, deletes } = jar();
    expect(takeFlash({ cookies, url })).toBeNull();
    expect(deletes).toEqual([]);
  });

  it("clears the cookie at the path it was written for, and trims what it reads", () => {
    const { cookies, deletes } = jar(JSON.stringify({ tone: "info", title: "x".repeat(500), path: "/admin/users/u1" }));
    expect(takeFlash({ cookies, url })).toEqual({ tone: "info", title: "x".repeat(120) });
    expect(deletes).toEqual([{ name: "ttv-flash", options: { path: "/admin/users/u1" } }]);
  });
});
