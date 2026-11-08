import { describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ communityResponse: vi.fn() }));
vi.mock("./route", () => route);
const { communityFetch } = await import("./in-process");

const PAGE = "https://ttv.invalid/dashboard/discover";
const locals = {} as App.Locals;
const env = {} as Env;

describe("communityFetch", () => {
  it("answers the community API in process, lending only the page's cookie, authorization, origin and user agent", async () => {
    route.communityResponse.mockResolvedValue(Response.json({ ok: true }));
    const page = new Request(PAGE, { method: "POST", headers: { cookie: "s=1", origin: "https://ttv.invalid", "user-agent": "UA", "x-forwarded-for": "1.2.3.4", "content-type": "application/x-www-form-urlencoded" } });
    const fetcher = communityFetch(page, locals, env);
    const response = await fetcher("/api/community/profiles?query=Achieng&limit=50");
    expect(await response.json()).toEqual({ ok: true });
    const [request, path, passedLocals, passedEnv] = route.communityResponse.mock.calls[0]!;
    expect(path).toBe("profiles");
    expect(new URL(request.url).search).toBe("?query=Achieng&limit=50");
    expect(request.method).toBe("GET");
    expect([...request.headers.keys()].toSorted()).toEqual(["cookie", "origin", "user-agent"]);
    expect([passedLocals, passedEnv]).toEqual([locals, env]);
  });

  it("sends a write's JSON body", async () => {
    route.communityResponse.mockResolvedValue(Response.json({}));
    await communityFetch(new Request(PAGE), locals, env)("/api/community/chat", { method: "POST", body: JSON.stringify({ message: "Hi" }) });
    const [request, path] = route.communityResponse.mock.calls.at(-1)!;
    expect(path).toBe("chat");
    expect(request.headers.get("content-type")).toBe("application/json");
    expect(await request.json()).toEqual({ message: "Hi" });
  });

  it.each(["https://elsewhere.example/api/community/access", "/api/admin/users", "/dashboard/community"])("answers nothing but this site's community API: %s", async (input) => {
    await expect(communityFetch(new Request(PAGE), locals, env)(input)).rejects.toThrow(TypeError);
  });
});
