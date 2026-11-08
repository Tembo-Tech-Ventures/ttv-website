import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { beforeAll, describe, expect, it } from "vitest";

const { default: FlashPage } = await import("./_fixtures/FlashPage.astro");

let container: AstroContainer;
beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

const PAGE = "https://tembotechventures.com/admin/programs/cohort-05";

/**
 * The Set-Cookie lines of a response, one per cookie, read the way the adapter
 * writes them (Astro hands the page's cookies over on this symbol).
 */
const setCookies = (response: Response): string[] => {
  const cookies = Reflect.get(response, Symbol.for("astro.cookies")) as { consume(): Iterable<string> } | undefined;
  return [...response.headers.getSetCookie(), ...(cookies ? cookies.consume() : [])];
};
const cookiePair = (line: string) => line.split(";")[0];

async function post() {
  return container.renderToResponse(FlashPage, { request: new Request(PAGE, { method: "POST" }) });
}

async function get(cookie?: string) {
  return container.renderToResponse(FlashPage, { request: new Request(PAGE, { headers: cookie ? { cookie } : {} }) });
}

describe("a flash after a 303", () => {
  it("answers the POST with a 303 to the page and a short-lived cookie scoped to it", async () => {
    const response = await post();
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/admin/programs/cohort-05");
    const [line] = setCookies(response);
    expect(line).toMatch(/^ttv-flash=/);
    expect(line).toContain("Path=/admin/programs/cohort-05");
    expect(line).toContain("Max-Age=60");
    expect(line).toContain("HttpOnly");
    expect(line).toContain("SameSite=Lax");
    expect(line).toContain("Secure");
  });

  it("shows on the next GET once, and that GET clears it", async () => {
    const cookie = cookiePair(setCookies(await post())[0]);
    const first = await get(cookie);
    const html = await first.text();
    expect(html).toContain('data-notice="success"');
    expect(html).toContain("Cohort updated");
    expect(html).toContain("Wanjiku sees the new dates.");
    const [cleared] = setCookies(first);
    expect(cleared).toMatch(/^ttv-flash=deleted;/);
    expect(cleared).toContain("Path=/admin/programs/cohort-05");
    expect(cleared).toContain("Expires=Thu, 01 Jan 1970");

    const reload = await (await get()).text();
    expect(reload).not.toContain("data-notice");
  });

  it("reads a cookie it did not write as nothing, and still clears it", async () => {
    for (const value of ["not-json", encodeURIComponent(JSON.stringify({ tone: "danger", title: "Hacked" })), encodeURIComponent("[1]")]) {
      const response = await get(`ttv-flash=${value}`);
      expect(await response.text()).not.toContain("data-notice");
      expect(setCookies(response)[0]).toMatch(/^ttv-flash=deleted;/);
    }
  });
});
