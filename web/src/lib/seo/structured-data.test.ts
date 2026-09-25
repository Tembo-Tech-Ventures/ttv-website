import { describe, expect, it } from "vitest";
import {
  buildArticleJsonLd,
  buildPersonJsonLd,
  serializeJsonLd,
} from "./structured-data";

describe("buildPersonJsonLd", () => {
  it("builds a public profile Person and omits empty optional fields", () => {
    expect(
      buildPersonJsonLd({
        name: "Amina Fixture",
        url: "https://tembotechventures.com/talent/amina-preview",
        image: null,
        headline: "Full-stack developer",
        description: " Builds tools\nwith communities across Africa. ",
        sameAs: ["https://github.com/amina", null, ""],
      })
    ).toEqual({
      "@context": "https://schema.org",
      "@type": "Person",
      name: "Amina Fixture",
      url: "https://tembotechventures.com/talent/amina-preview",
      jobTitle: "Full-stack developer",
      description: "Builds tools with communities across Africa.",
      sameAs: ["https://github.com/amina"],
    });
  });
});

describe("buildArticleJsonLd", () => {
  it("builds an Article with canonical dates, author, and publisher", () => {
    const data = buildArticleJsonLd({
      title: "Building a useful field tool",
      url: "https://tembotechventures.com/blog/amina-preview/field-tool",
      description: "What I learned while building with a local team.",
      publishedAt: new Date("2026-09-20T10:00:00.000Z"),
      updatedAt: new Date("2026-09-21T11:00:00.000Z"),
      siteOrigin: "https://tembotechventures.com",
      author: {
        name: "Amina Fixture",
        url: "https://tembotechventures.com/talent/amina-preview",
      },
    });

    expect(data).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Article",
      headline: "Building a useful field tool",
      datePublished: "2026-09-20T10:00:00.000Z",
      dateModified: "2026-09-21T11:00:00.000Z",
      author: {
        "@type": "Person",
        name: "Amina Fixture",
      },
      publisher: {
        "@type": "Organization",
        name: "Tembo Tech Ventures",
        logo: {
          url: "https://tembotechventures.com/og-default.png",
        },
      },
    });
    expect(data.author).not.toHaveProperty("@context");
  });

  it("clips an overlong article description through the shared normalizer", () => {
    const data = buildArticleJsonLd({
      title: "Long description",
      url: "https://example.com/post",
      description: "word ".repeat(80),
      publishedAt: new Date("2026-09-20T10:00:00.000Z"),
      updatedAt: new Date("2026-09-20T10:00:00.000Z"),
      siteOrigin: "https://example.com",
      author: { name: "Amina", url: "https://example.com/amina" },
    });
    expect(data.description?.endsWith("…")).toBe(true);
    expect(data.description!.length).toBeLessThanOrEqual(161);
  });
});

describe("serializeJsonLd", () => {
  it("keeps script-closing text inside the JSON value", () => {
    const serialized = serializeJsonLd({ title: "</script><script>bad()</script>" });
    expect(serialized).not.toContain("</script>");
    expect(JSON.parse(serialized)).toEqual({
      title: "</script><script>bad()</script>",
    });
  });
});
