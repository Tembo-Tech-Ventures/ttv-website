import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { FIXTURE_ENVIRONMENT } from "./fixture-env";

const EVIDENCE_DIR = "test-results/evidence";
mkdirSync(EVIDENCE_DIR, { recursive: true });

const evidence = (name: string) =>
  `${EVIDENCE_DIR}/${test.info().project.name}-${name}.png`;

const READER_PATH = "/blog/amina-preview/building-resilient-interfaces";

async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  await expect
    .poll(() =>
      page.evaluate(
        () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
      )
    )
    .toBe(true);
}

async function parseXml(page: import("@playwright/test").Page, xml: string) {
  return page.evaluate((source) => {
    const document = new DOMParser().parseFromString(source, "application/xml");
    return {
      parserErrors: document.querySelectorAll("parsererror").length,
      root: document.documentElement.localName,
    };
  }, xml);
}

test.describe("public blog reader", () => {
  test.skip(
    !FIXTURE_ENVIRONMENT,
    "Requires seeded blog fixtures (agent-* environments only)."
  );

  test("listing shows the published fixture and its author", async ({ page }) => {
    const response = await page.goto("/blog");
    expect(response?.status()).toBe(200);
    const readerPost = page.getByRole("article").filter({
      has: page.getByRole("heading", {
        name: "Building resilient interfaces from field conversations",
      }),
    });
    await expect(readerPost).toBeVisible();
    await expect(
      readerPost.getByRole("link", { name: "Amina Fixture", exact: true })
    ).toHaveAttribute("href", "/talent/amina-preview");
    await expect(page.getByText(/2 min read/i).first()).toBeVisible();
    await expect(
      page.locator('link[rel="alternate"][type="application/rss+xml"]')
    ).toHaveAttribute("href", "/blog/rss.xml");
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: evidence("blog-listing"), fullPage: true });
  });

  test("post renders its title, author, content, metadata, and back link", async ({
    page,
  }) => {
    const response = await page.goto(READER_PATH);
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(
      page.getByRole("heading", {
        level: 1,
        name: "Building resilient interfaces from field conversations",
      })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: /Amina Fixture/ })).toHaveAttribute(
      "href",
      "/talent/amina-preview"
    );
    await expect(
      page.getByRole("link", { name: /back to field notes/i })
    ).toHaveAttribute("href", "/blog");
    await expect(page.getByText("Start with the conversation")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "More from Amina Fixture" })
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: /Notes on debugging at the edge/ })
    ).toHaveAttribute("href", "/blog/amina-preview/debugging-at-the-edge");
    await expect(page.locator('meta[property="og:type"]')).toHaveAttribute(
      "content",
      "article"
    );
    await expect(
      page.locator('meta[property="article:published_time"]')
    ).toHaveAttribute("content", /2026-/);
    await expect(page.locator('meta[name="description"]')).toHaveAttribute(
      "content",
      /Nairobi commuters/
    );
    const jsonLd = await page.locator('script[type="application/ld+json"]').textContent();
    expect(JSON.parse(jsonLd ?? "{}")).toMatchObject({
      "@type": "Article",
      author: { "@type": "Person", name: "Amina Fixture" },
    });
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: evidence("blog-post"), fullPage: true });
  });

  test("homepage shows the latest-posts strip when public posts exist", async ({
    page,
  }) => {
    await page.goto("/");
    const section = page.getByRole("region", { name: "Latest posts" });
    await expect(section).toBeVisible();
    await expect(
      section.getByRole("link", {
        name: "Building resilient interfaces from field conversations",
      })
    ).toHaveAttribute("href", READER_PATH);
  });

  test("RSS is valid XML containing the public item", async ({ page, request }) => {
    const response = await request.get("/blog/rss.xml");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/rss+xml");
    expect(response.headers()["cache-control"]).toBe("public, max-age=600");
    const xml = await response.text();
    expect(await parseXml(page, xml)).toEqual({ parserErrors: 0, root: "rss" });
    expect(xml).toContain("Building resilient interfaces from field conversations");
    expect(xml).toContain(READER_PATH);
  });

  test("sitemap is valid XML containing the eligible profile and post", async ({
    page,
    request,
  }) => {
    const response = await request.get("/sitemap.xml");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/xml");
    expect(response.headers()["cache-control"]).toBe("public, max-age=3600");
    const xml = await response.text();
    expect(await parseXml(page, xml)).toEqual({
      parserErrors: 0,
      root: "urlset",
    });
    expect(xml).toContain("/talent/amina-preview");
    expect(xml).toContain(READER_PATH);
    expect(xml).not.toContain("draft-not-public");
    expect(xml).not.toContain("suspended-not-public");

    const robots = await request.get("/robots.txt");
    expect(robots.status()).toBe(200);
    expect(await robots.text()).toContain(
      "Sitemap: https://tembotechventures.com/sitemap.xml"
    );
  });

  test("draft and suspended posts return the public 404 state", async ({ page }) => {
    for (const slug of ["draft-not-public", "suspended-not-public"]) {
      const response = await page.goto(`/blog/amina-preview/${slug}`);
      expect(response?.status()).toBe(404);
      await expect(
        page.getByRole("heading", { name: /isn.t published/i })
      ).toBeVisible();
      await expect(
        page.getByRole("link", { name: /back to field notes/i })
      ).toBeVisible();
    }
  });

  test("public pages expose descriptions and the default sharing image", async ({
    page,
  }) => {
    for (const path of ["/", "/talent", "/talent/amina-preview", "/hire", "/blog"]) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      const description = await page.locator('meta[name="description"]').getAttribute("content");
      expect(description?.trim().length).toBeGreaterThan(30);
      await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
        "content",
        "https://tembotechventures.com/og-default.png"
      );
    }

    await page.goto("/talent/amina-preview");
    const personJsonLd = await page
      .locator('script[type="application/ld+json"]')
      .textContent();
    expect(JSON.parse(personJsonLd ?? "{}")).toMatchObject({
      "@type": "Person",
      name: "Amina Fixture",
    });
  });
});
