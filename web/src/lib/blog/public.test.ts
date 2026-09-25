import { describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/db/schema";
import {
  findPublicPost,
  isEligiblePublicProfile,
  listPublicPosts,
  listPublicProfiles,
} from "./public";

const NOW = new Date("2026-09-25T12:00:00.000Z");
const EARLIER = new Date("2026-09-20T12:00:00.000Z");

function profile(overrides: Record<string, unknown> = {}) {
  return {
    id: "profile-1",
    handle: "amina-preview",
    status: "PUBLISHED",
    headline: "Full-stack developer",
    bio: "I build useful tools with my community.",
    updatedAt: NOW,
    user: {
      id: "user-1",
      name: "Amina Fixture",
      image: null,
      programApplications: [{ status: "COMPLETED", completedAt: EARLIER }],
    },
    posts: [
      {
        id: "post-new",
        slug: "new-post",
        title: "New post",
        status: "PUBLISHED",
        excerpt: "Newest",
        contentHtml: "<p>Newest</p>",
        readingMinutes: 2,
        coverImageKey: null,
        coverImageAlt: null,
        publishedAt: NOW,
        updatedAt: NOW,
      },
      {
        id: "post-old",
        slug: "old-post",
        title: "Old post",
        status: "PUBLISHED",
        excerpt: "Older",
        contentHtml: "<p>Older</p>",
        readingMinutes: 1,
        coverImageKey: null,
        coverImageAlt: null,
        publishedAt: EARLIER,
        updatedAt: EARLIER,
      },
    ],
    ...overrides,
  };
}

function dbWith(rows: unknown[], found?: unknown) {
  return {
    query: {
      studentProfile: {
        findMany: vi.fn().mockResolvedValue(rows),
        findFirst: vi.fn().mockResolvedValue(found),
      },
    },
  } as unknown as Database;
}

describe("isEligiblePublicProfile", () => {
  it("uses the talent completion rule as well as published profile status", () => {
    expect(isEligiblePublicProfile(profile())).toBe(true);
    expect(isEligiblePublicProfile(profile({ status: "SUSPENDED" }))).toBe(false);
    expect(
      isEligiblePublicProfile(
        profile({
          user: {
            id: "user-1",
            name: "Amina Fixture",
            image: null,
            programApplications: [
              { status: "COMPLETED", completedAt: null },
            ],
          },
        })
      )
    ).toBe(false);
  });
});

describe("public blog queries", () => {
  it("excludes profiles without a valid completion and their posts", async () => {
    const invalid = profile({
      id: "profile-invalid",
      handle: "invalid",
      user: {
        id: "user-invalid",
        name: "Invalid",
        image: null,
        programApplications: [{ status: "COMPLETED", completedAt: null }],
      },
    });
    const db = dbWith([invalid, profile()]);

    await expect(listPublicProfiles(db)).resolves.toHaveLength(1);
    await expect(listPublicPosts(db)).resolves.toHaveLength(2);
  });

  it("defensively excludes non-published posts and returns newest first", async () => {
    const row = profile();
    row.posts.push({
      ...row.posts[0],
      id: "post-suspended",
      slug: "taken-down",
      status: "SUSPENDED",
    });
    const posts = await listPublicPosts(dbWith([row]));

    expect(posts.map((post) => post.id)).toEqual(["post-new", "post-old"]);
  });

  it("applies the requested limit after sorting all eligible authors", async () => {
    const posts = await listPublicPosts(dbWith([profile()]), { limit: 1 });
    expect(posts.map((post) => post.id)).toEqual(["post-new"]);
  });

  it("finds a public post and up to three more posts from the same author", async () => {
    const result = await findPublicPost(
      dbWith([], profile()),
      "amina-preview",
      "new-post"
    );

    expect(result?.post.id).toBe("post-new");
    expect(result?.more.map((post) => post.id)).toEqual(["post-old"]);
  });

  it("returns no post for an ineligible profile or non-published slug", async () => {
    const suspended = profile({ status: "SUSPENDED" });
    await expect(
      findPublicPost(dbWith([], suspended), "amina-preview", "new-post")
    ).resolves.toBeUndefined();

    await expect(
      findPublicPost(dbWith([], profile()), "amina-preview", "missing")
    ).resolves.toBeUndefined();
  });
});
