import { describe, expect, it } from "vitest";
import { postPath, canonicalPostUrl, toFeedItem } from "./feed";

describe("postPath", () => {
  it("builds the canonical blog post path", () => {
    expect(postPath("amina", "hello-world")).toBe("/blog/amina/hello-world");
  });

  it("does not encode the handle or slug", () => {
    expect(postPath("test-user", "my-post")).toBe("/blog/test-user/my-post");
  });
});

describe("canonicalPostUrl", () => {
  it("combines site origin with the post path", () => {
    expect(
      canonicalPostUrl("https://tembotechventures.com", "amina", "hello")
    ).toBe("https://tembotechventures.com/blog/amina/hello");
  });

  it("does not double the slash", () => {
    const url = canonicalPostUrl(
      "https://tembotechventures.com",
      "bob",
      "post"
    );
    expect(url).not.toContain("//blog");
  });
});

describe("toFeedItem", () => {
  const post = {
    title: "My Post",
    slug: "my-post",
    excerpt: "A short summary",
    readingMinutes: 3,
    publishedAt: new Date("2026-01-15T12:00:00Z"),
    coverImageKey: "blog-covers/abc/123.webp",
    coverImageAlt: "A photo",
    profile: {
      handle: "amina",
      user: { name: "Amina K" },
    },
  };

  it("maps all fields correctly", () => {
    const item = toFeedItem(post);
    expect(item).toEqual({
      title: "My Post",
      path: "/blog/amina/my-post",
      excerpt: "A short summary",
      authorName: "Amina K",
      authorHandle: "amina",
      publishedAt: new Date("2026-01-15T12:00:00Z"),
      readingMinutes: 3,
      coverImageKey: "blog-covers/abc/123.webp",
      coverImageAlt: "A photo",
    });
  });

  it("passes null excerpt through", () => {
    const item = toFeedItem({ ...post, excerpt: null });
    expect(item.excerpt).toBeNull();
  });

  it("passes null cover image through", () => {
    const item = toFeedItem({
      ...post,
      coverImageKey: null,
      coverImageAlt: null,
    });
    expect(item.coverImageKey).toBeNull();
    expect(item.coverImageAlt).toBeNull();
  });
});
