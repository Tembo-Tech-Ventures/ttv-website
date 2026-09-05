/**
 * The form actions behind the editor.
 *
 * The property under test throughout is that a status change carries the post's
 * content with it. The editor autosaves on a timer, so publishing on an id
 * alone publishes whatever the last save happened to catch — and the sentence
 * written just before pressing Publish is exactly the one that goes missing.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Database } from "@/lib/db/schema";
import {
  handlePostAction,
  parsePostAction,
  postInputFromFormData,
} from "./blog-handlers";

// `handlePostAction` calls the other exports of its own module directly, so
// they cannot be intercepted by mocking the module. The database is mocked one
// layer down instead, which also keeps the real validation in the path.
const findFirst = vi.fn();
const returning = vi.fn();

function withReturning(changes = 1) {
  const resolved = { meta: { changes } };
  const p = Promise.resolve(resolved) as Promise<typeof resolved> & {
    returning: typeof returning;
  };
  p.returning = returning;
  return p;
}

const db = {
  query: { blogPost: { findFirst } },
  update: () => ({ set: () => ({ where: () => withReturning() }) }),
  insert: () => ({ values: () => ({ returning }) }),
  delete: () => ({ where: () => Promise.resolve({ meta: { changes: 1 } }) }),
} as unknown as Database;

/**
 * The columns a Drizzle condition refers to.
 *
 * Walks the nested `queryChunks` a `and(eq(...), ne(...))` builds. Reaching
 * into Drizzle's internals is not something to do lightly, but the alternative
 * for "the update is scoped to a post this author is still allowed to edit" is
 * to assert nothing at all: the fake database sees an opaque object, and a
 * dropped condition changes no behaviour a fake can observe. If Drizzle ever
 * changes shape this returns nothing and the tests below fail loudly rather
 * than passing quietly.
 */
function columnsReferencedBy(condition: unknown): string[] {
  const names: string[] = [];
  // A column points back at its table, which points back at its columns, so an
  // unguarded walk never terminates.
  const seen = new WeakSet<object>();

  const visit = (node: unknown) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);

    const record = node as Record<string, unknown>;
    if (typeof record.name === "string" && "table" in record) {
      names.push(record.name);
      // Descending into the table from here would enumerate every column in it
      // and make the assertion meaningless.
      return;
    }
    for (const value of Object.values(record)) {
      if (Array.isArray(value)) value.forEach(visit);
      else visit(value);
    }
  };

  visit(condition);
  return names;
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.append(key, value);
  return data;
}

const DRAFT = {
  title: "Ten conversations",
  slug: "",
  contentMarkdown: "What we heard, and what we changed.",
};

beforeEach(() => {
  vi.clearAllMocks();
  findFirst.mockResolvedValue(undefined);
  returning.mockResolvedValue([{ id: "post-1" }]);
});

describe("parsePostAction", () => {
  it("accepts the four actions the editor sends", () => {
    for (const action of ["save", "publish", "unpublish", "delete"] as const) {
      expect(parsePostAction(action)).toBe(action);
    }
  });

  it("falls back to saving for anything else", () => {
    // A hand-crafted POST must not be able to name an action that does not
    // exist and reach some other branch; saving is the harmless default.
    expect(parsePostAction("destroy")).toBe("save");
    expect(parsePostAction(null)).toBe("save");
    expect(parsePostAction(undefined)).toBe("save");
    expect(parsePostAction(42)).toBe("save");
  });
});

describe("postInputFromFormData", () => {
  it("reads the editor's fields", () => {
    expect(
      postInputFromFormData(
        form({ ...DRAFT, slug: "ten", excerpt: "A summary." })
      )
    ).toEqual({
      title: "Ten conversations",
      slug: "ten",
      contentMarkdown: "What we heard, and what we changed.",
      excerpt: "A summary.",
      coverImageAlt: undefined,
    });
  });

  it("treats a blank excerpt as one to derive", () => {
    expect(postInputFromFormData(form({ ...DRAFT, excerpt: "" }))).toMatchObject(
      { excerpt: undefined }
    );
  });
});

describe("handlePostAction", () => {
  it("creates the post and sends the browser to it", async () => {
    const outcome = await handlePostAction(db, "profile-1", form(DRAFT));

    expect(outcome.result.success).toBe(true);
    // Staying on /new would make the next submission create a second post.
    expect(outcome.redirectTo).toBe("/dashboard/writing/post-1");
  });

  it("stays put when saving a post that already exists", async () => {
    const outcome = await handlePostAction(db, "profile-1", form(DRAFT), "post-1");

    expect(outcome.result.success).toBe(true);
    expect(outcome.redirectTo).toBeUndefined();
  });

  it("saves the submitted content before publishing it", async () => {
    findFirst
      // The slug-uniqueness lookup: no other post owns this slug.
      .mockResolvedValueOnce(undefined)
      // Then `publishPost` reads the post it is about to transition.
      .mockResolvedValue({ status: "DRAFT", publishedAt: null });
    const set = vi.fn((_values: unknown) => ({ where: () => withReturning() }));
    const publishing = {
      ...db,
      update: () => ({ set }),
    } as unknown as Database;

    const outcome = await handlePostAction(
      publishing,
      "profile-1",
      form({ ...DRAFT, _action: "publish" }),
      "post-1"
    );

    expect(outcome.result.success).toBe(true);
    expect(outcome.redirectTo).toBe("/dashboard/writing/post-1");

    // Two updates: the content, then the status. The content one has to come
    // first, or the post goes live one autosave behind what was on screen.
    expect(set).toHaveBeenCalledTimes(2);
    expect(set.mock.calls[0][0]).toMatchObject({
      title: "Ten conversations",
      contentMarkdown: "What we heard, and what we changed.",
    });
    expect(set.mock.calls[1][0]).toMatchObject({ status: "PUBLISHED" });
  });

  it("does not change status when the save is rejected", async () => {
    const set = vi.fn((_values: unknown) => ({ where: () => withReturning() }));
    const rejecting = { ...db, update: () => ({ set }) } as unknown as Database;

    const outcome = await handlePostAction(
      rejecting,
      "profile-1",
      // No title: the post cannot be saved, so it must not be published either.
      form({ ...DRAFT, title: "", _action: "publish" }),
      "post-1"
    );

    expect(outcome.result.success).toBe(false);
    expect(outcome.redirectTo).toBeUndefined();
    expect(set).not.toHaveBeenCalled();
  });

  it("refuses to delete a post that was never created", async () => {
    const outcome = await handlePostAction(
      db,
      "profile-1",
      form({ ...DRAFT, _action: "delete" })
    );

    expect(outcome.result.success).toBe(false);
    expect(outcome.redirectTo).toBeUndefined();
  });

  it("returns to the list after deleting a draft", async () => {
    findFirst.mockResolvedValue({ status: "DRAFT" });

    const outcome = await handlePostAction(
      db,
      "profile-1",
      form({ ...DRAFT, _action: "delete" }),
      "post-1"
    );

    expect(outcome.result.success).toBe(true);
    expect(outcome.redirectTo).toBe("/dashboard/writing");
  });

  it("will not delete a published post", async () => {
    findFirst.mockResolvedValue({ status: "PUBLISHED" });

    const outcome = await handlePostAction(
      db,
      "profile-1",
      form({ ...DRAFT, _action: "delete" }),
      "post-1"
    );

    expect(outcome.result.success).toBe(false);
    expect(outcome.result.error).toMatch(/draft/i);
  });

  it("updates only a post this author is still allowed to edit", async () => {
    // A suspended post is read-only. The page hides the editor for one, but
    // this handler and the autosave endpoint are reachable without the page —
    // so the filter, not the UI, is what stops an author rewriting content an
    // admin has taken down.
    const where = vi.fn((_condition: unknown) => ({ returning }));
    const scoped = {
      ...db,
      update: () => ({ set: () => ({ where }) }),
    } as unknown as Database;

    await handlePostAction(scoped, "profile-1", form(DRAFT), "post-1");

    const referenced = columnsReferencedBy(where.mock.calls[0][0]);
    expect(referenced).toContain("id");
    expect(referenced).toContain("profileId");
    expect(referenced).toContain("status");
  });

  it("tells the author when the post can no longer be edited", async () => {
    // No rows matched — the post was suspended, or belongs to someone else.
    returning.mockResolvedValue([]);

    const outcome = await handlePostAction(db, "profile-1", form(DRAFT), "post-1");

    expect(outcome.result.success).toBe(false);
    expect(outcome.result.error).toMatch(/no longer be edited/i);
  });

  it("reports a rejected slug without touching the post", async () => {
    // Another post of this author's already owns the slug.
    findFirst.mockResolvedValue({ id: "other-post" });
    const set = vi.fn((_values: unknown) => ({ where: () => withReturning() }));
    const clashing = { ...db, update: () => ({ set }) } as unknown as Database;

    const outcome = await handlePostAction(
      clashing,
      "profile-1",
      form({ ...DRAFT, slug: "ten-conversations" }),
      "post-1"
    );

    expect(outcome.result.success).toBe(false);
    expect(outcome.result.slugError).toMatch(/already have a post/i);
    expect(set).not.toHaveBeenCalled();
  });
});
