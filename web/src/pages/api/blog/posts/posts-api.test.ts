/**
 * The autosave endpoints.
 *
 * These are the one path into a post that does not go through the page, so the
 * gate they carry is the whole test: an unauthenticated request, or a request
 * from someone whose profile is not published, must not be able to create or
 * change a post by calling them directly.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("cloudflare:workers", () => ({ env: { DB: {} } }));

const mockGetSession = vi.fn();
vi.mock("@/lib/auth", () => ({
  createAuth: () => ({ api: { getSession: mockGetSession } }),
}));

const mockFindProfile = vi.fn();
vi.mock("drizzle-orm/d1", () => ({
  drizzle: () => ({
    query: { studentProfile: { findFirst: mockFindProfile } },
  }),
}));

const mockSavePost = vi.fn();
vi.mock("@/components/blog/blog-handlers", () => ({
  savePost: (...args: unknown[]) => mockSavePost(...args),
}));

import { POST } from "./index";
import { PUT } from "./[id]";

const BODY = {
  title: "A post",
  slug: "",
  excerpt: "",
  contentMarkdown: "Something worth saying.",
};

const SAVED = { slug: "a-post", excerpt: "Something…", readingMinutes: 1 };

function request(body: unknown = BODY) {
  return new Request("https://example.com/api/blog/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function create(body?: unknown) {
  return POST({ request: request(body) } as Parameters<typeof POST>[0]);
}

function update(id: string | undefined, body?: unknown) {
  return PUT({
    request: request(body),
    params: { id },
  } as unknown as Parameters<typeof PUT>[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetSession.mockResolvedValue({ user: { id: "user-1" } });
  mockFindProfile.mockResolvedValue({ id: "profile-1", status: "PUBLISHED" });
  mockSavePost.mockResolvedValue({
    success: true,
    postId: "post-1",
    saved: SAVED,
  });
});

describe("who may save a post", () => {
  it("refuses a request with no session", async () => {
    mockGetSession.mockResolvedValue(null);

    for (const response of [await create(), await update("post-1")]) {
      expect(response.status).toBe(401);
    }
    expect(mockSavePost).not.toHaveBeenCalled();
  });

  it("refuses an author with no profile", async () => {
    mockFindProfile.mockResolvedValue(undefined);

    expect((await create()).status).toBe(403);
    expect(mockSavePost).not.toHaveBeenCalled();
  });

  it("refuses an author whose profile is not published", async () => {
    // The page gates on this too, but the page is not the only way in — and an
    // unpublished profile has no public blog for a post to appear on.
    for (const status of ["DRAFT", "PENDING", "SUSPENDED"]) {
      mockFindProfile.mockResolvedValue({ id: "profile-1", status });
      expect((await create()).status).toBe(403);
      expect((await update("post-1")).status).toBe(403);
    }
    expect(mockSavePost).not.toHaveBeenCalled();
  });

  it("scopes every save to the author's own profile", async () => {
    await create();
    expect(mockSavePost).toHaveBeenCalledWith(
      expect.anything(),
      "profile-1",
      expect.anything(),
    );

    await update("someone-elses-post");
    // The post id is passed through unchecked on purpose: `savePost` matches on
    // profile as well as id, so an id from another account updates no rows.
    expect(mockSavePost).toHaveBeenLastCalledWith(
      expect.anything(),
      "profile-1",
      expect.anything(),
      "someone-elses-post",
    );
  });
});

describe("creating a post", () => {
  it("returns the id and what the server derived", async () => {
    const response = await create();
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ id: "post-1", ...SAVED });
  });

  it("asks for a derived excerpt rather than storing an empty one", async () => {
    await create({ ...BODY, excerpt: "" });
    // `undefined` means "derive one from the body". An empty string would be
    // stored verbatim and the blog index would show a post with no summary.
    expect(mockSavePost.mock.calls[0][2]).toMatchObject({ excerpt: undefined });
  });

  it("passes a written excerpt through", async () => {
    await create({ ...BODY, excerpt: "Hand written." });
    expect(mockSavePost.mock.calls[0][2]).toMatchObject({
      excerpt: "Hand written.",
    });
  });

  it("rejects a body that is not JSON", async () => {
    const response = await POST({
      request: new Request("https://example.com/api/blog/posts", {
        method: "POST",
        body: "not json",
      }),
    } as Parameters<typeof POST>[0]);
    expect(response.status).toBe(400);
  });

  it("rejects a body longer than a post may be", async () => {
    const response = await create({
      ...BODY,
      contentMarkdown: "x".repeat(40_001),
    });
    expect(response.status).toBe(400);
    expect(mockSavePost).not.toHaveBeenCalled();
  });
});

describe("reporting a refused save", () => {
  it("passes the slug conflict back so the panel can show it", async () => {
    mockSavePost.mockResolvedValue({
      success: false,
      slugError: "You already have a post with this slug",
    });

    const response = await update("post-1");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      slugError: "You already have a post with this slug",
    });
  });

  it("reports a suspended post as no longer editable", async () => {
    mockSavePost.mockResolvedValue({
      success: false,
      error: "This post can no longer be edited",
    });

    const response = await update("post-1");
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: "This post can no longer be edited",
    });
  });

  it("surfaces a field error rather than a blank message", async () => {
    mockSavePost.mockResolvedValue({
      success: false,
      fieldErrors: { title: "Title is required" },
    });

    expect(await (await create()).json()).toMatchObject({
      error: "Title is required",
    });
  });

  it("refuses an update with no post id", async () => {
    expect((await update(undefined)).status).toBe(404);
    expect(mockSavePost).not.toHaveBeenCalled();
  });
});
