import { describe, expect, it } from "vitest";
import { buildRssResponse } from "./rss-route";

describe("buildRssResponse", () => {
  it("returns cacheable RSS XML with the supplied item", async () => {
    const response = buildRssResponse("https://tembotechventures.com", [
      {
        title: "A field note",
        path: "/blog/amina-preview/a-field-note",
        excerpt: "What we learned.",
        authorName: "Amina Fixture",
        authorHandle: "amina-preview",
        publishedAt: new Date("2026-09-25T10:00:00.000Z"),
        readingMinutes: 2,
        coverImageKey: null,
        coverImageAlt: null,
      },
    ]);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe(
      "application/rss+xml; charset=utf-8"
    );
    expect(response.headers.get("cache-control")).toBe("public, max-age=600");
    expect(await response.text()).toContain("A field note");
  });
});
