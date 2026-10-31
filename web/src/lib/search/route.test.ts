import type { APIContext } from "astro";
import { expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ env: { DB: {} }, searchRequest: vi.fn() }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("./http", () => ({ searchRequest: mocks.searchRequest }));
import { GET } from "@/pages/api/search";

it("wires the GET route to the authorized handler and Cloudflare bindings", async () => {
  const response = Response.json({ error: { code: "flag_off", message: "Not found." } }, { status: 404 });
  mocks.searchRequest.mockResolvedValueOnce(response);
  const context = { request: new Request("https://example.test/api/search"), locals: {} } as APIContext;
  expect(await GET(context)).toBe(response);
  expect(mocks.searchRequest).toHaveBeenCalledExactlyOnceWith(context, mocks.env);
});
