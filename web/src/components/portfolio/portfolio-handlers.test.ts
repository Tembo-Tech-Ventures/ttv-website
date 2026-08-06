import { describe, it, expect, vi } from "vitest";
import {
  extractProfileFormData,
  validateProfileHandle,
  saveProfile,
  submitForReview,
} from "./portfolio-handlers";

function makeFormData(entries: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) {
    fd.set(k, v);
  }
  return fd;
}

describe("extractProfileFormData", () => {
  it("extracts text fields correctly", () => {
    const fd = makeFormData({
      handle: " MyHandle ",
      headline: "Full-Stack Dev",
      bio: "Hello world",
      location: "Lagos",
      country: "Nigeria",
      skills: "TypeScript, React, Node.js",
      portfolioUrl: "https://example.com",
      linkedinUrl: "https://linkedin.com/in/test",
    });
    const result = extractProfileFormData(fd);
    expect(result.handle).toBe(" MyHandle ");
    expect(result.headline).toBe("Full-Stack Dev");
    expect(result.bio).toBe("Hello world");
    expect(result.location).toBe("Lagos");
    expect(result.country).toBe("Nigeria");
    expect(result.skills).toEqual(["TypeScript", "React", "Node.js"]);
    expect(result.portfolioUrl).toBe("https://example.com");
    expect(result.linkedinUrl).toBe("https://linkedin.com/in/test");
  });

  it("maps empty strings to undefined for optional fields", () => {
    const fd = makeFormData({ handle: "test" });
    const result = extractProfileFormData(fd);
    expect(result.headline).toBeUndefined();
    expect(result.bio).toBeUndefined();
    expect(result.skills).toBeUndefined();
  });

  it("maps checkbox 'on' to true, absent to false", () => {
    const fd = makeFormData({ handle: "test", openToFreelance: "on" });
    const result = extractProfileFormData(fd);
    expect(result.openToFreelance).toBe(true);
    expect(result.openToRoles).toBe(false);
  });

  it("filters empty skill tags from comma-separated input", () => {
    const fd = makeFormData({ handle: "test", skills: "React, , , Node.js, " });
    const result = extractProfileFormData(fd);
    expect(result.skills).toEqual(["React", "Node.js"]);
  });
});

function mockDb(overrides: {
  findProfile?: unknown;
  findProfileByHandle?: unknown;
  insertProfile?: () => void;
  updateProfile?: () => void;
} = {}) {
  const insertFn = vi.fn(overrides.insertProfile ?? (() => {}));
  const updateFn = vi.fn(overrides.updateProfile ?? (() => {}));

  return {
    query: {
      studentProfile: {
        findFirst: vi.fn(async (opts?: { where?: unknown; columns?: unknown }) => {
          if (opts?.where && typeof opts.where === "function") {
            return overrides.findProfile ?? null;
          }
          return overrides.findProfileByHandle ?? overrides.findProfile ?? null;
        }),
      },
    },
    insert: vi.fn(() => ({
      values: insertFn,
    })),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: updateFn,
      })),
    })),
  } as unknown;
}

describe("validateProfileHandle", () => {
  it("rejects empty handle", async () => {
    const db = mockDb();
    const result = await validateProfileHandle("", db as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("Handle is required");
  });

  it("rejects too-short handle", async () => {
    const db = mockDb();
    const result = await validateProfileHandle("ab", db as never);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBe("Handle must be at least 3 characters");
  });

  it("rejects reserved handle", async () => {
    const db = mockDb();
    const result = await validateProfileHandle("admin", db as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("This handle is reserved");
  });

  it("rejects invalid characters", async () => {
    const db = mockDb();
    const result = await validateProfileHandle("my_handle!", db as never);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toContain("lowercase letters, numbers, and hyphens");
  });

  it("rejects double hyphens", async () => {
    const db = mockDb();
    const result = await validateProfileHandle("my--handle", db as never);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toBe("Handle cannot contain consecutive hyphens");
  });

  it("rejects duplicate handle", async () => {
    const db = mockDb({ findProfileByHandle: { id: "other-id" } });
    const result = await validateProfileHandle("taken-handle", db as never);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe("This handle is already taken");
  });

  it("allows duplicate handle if same profile (update case)", async () => {
    const db = mockDb({ findProfileByHandle: { id: "same-id" } });
    const result = await validateProfileHandle(
      "my-handle",
      db as never,
      "same-id",
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.normalized).toBe("my-handle");
  });

  it("normalizes and accepts valid handle", async () => {
    const db = mockDb();
    const result = await validateProfileHandle("  MyHandle  ", db as never);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.normalized).toBe("myhandle");
  });
});

describe("saveProfile", () => {
  it("creates a new profile when no existing ID", async () => {
    const insertFn = vi.fn();
    const db = mockDb({ insertProfile: insertFn });

    const fd = makeFormData({
      handle: "new-user",
      headline: "Developer",
      bio: "I build things",
    });

    const result = await saveProfile(db as never, "user-1", fd);
    expect(result.success).toBe(true);
  });

  it("fails on validation error for handle", async () => {
    const db = mockDb();
    const fd = makeFormData({ handle: "ab" });

    const result = await saveProfile(db as never, "user-1", fd);
    expect(result.success).toBe(false);
    expect(result.handleError).toBeTruthy();
  });

  it("fails on invalid URL", async () => {
    const db = mockDb();
    const fd = makeFormData({
      handle: "valid-handle",
      portfolioUrl: "not-a-url",
    });

    const result = await saveProfile(db as never, "user-1", fd);
    expect(result.success).toBe(false);
    expect(result.fieldErrors?.portfolioUrl).toBeTruthy();
  });

  it("maps empty URL strings to null in DB values", async () => {
    const insertFn = vi.fn();
    const db = mockDb({ insertProfile: insertFn });

    const fd = makeFormData({
      handle: "valid-handle",
      portfolioUrl: "",
      linkedinUrl: "",
    });

    const result = await saveProfile(db as never, "user-1", fd);
    expect(result.success).toBe(true);
  });

  it("updates existing profile when ID provided", async () => {
    const updateFn = vi.fn();
    const db = mockDb({
      findProfileByHandle: null,
      updateProfile: updateFn,
    });

    const fd = makeFormData({
      handle: "existing-user",
      headline: "Updated headline",
    });

    const result = await saveProfile(
      db as never,
      "user-1",
      fd,
      "profile-1",
    );
    expect(result.success).toBe(true);
  });

  it("rejects skills exceeding max 12", async () => {
    const db = mockDb();
    const fd = makeFormData({
      handle: "valid-handle",
      skills: "a,b,c,d,e,f,g,h,i,j,k,l,m",
    });

    const result = await saveProfile(db as never, "user-1", fd);
    expect(result.success).toBe(false);
    expect(result.fieldErrors?.skills).toBeTruthy();
  });
});

describe("submitForReview", () => {
  it("transitions DRAFT to IN_REVIEW", async () => {
    const updateFn = vi.fn();
    const db = mockDb({
      findProfile: { status: "DRAFT" },
      updateProfile: updateFn,
    }) as Record<string, unknown>;

    db.query = {
      studentProfile: {
        findFirst: vi.fn(async () => ({ status: "DRAFT" })),
      },
    };

    const result = await submitForReview(db as never, "user-1", "profile-1");
    expect(result.success).toBe(true);
  });

  it("rejects transition from non-DRAFT status", async () => {
    const db = {
      query: {
        studentProfile: {
          findFirst: vi.fn(async () => ({ status: "IN_REVIEW" })),
        },
      },
    };

    const result = await submitForReview(db as never, "user-1", "profile-1");
    expect(result.success).toBe(false);
    expect(result.error).toContain("cannot be submitted");
  });

  it("rejects when profile not found", async () => {
    const db = {
      query: {
        studentProfile: {
          findFirst: vi.fn(async () => null),
        },
      },
    };

    const result = await submitForReview(db as never, "user-1", "profile-1");
    expect(result.success).toBe(false);
    expect(result.error).toBe("Profile not found");
  });

  it("rejects PUBLISHED status transition to IN_REVIEW", async () => {
    const db = {
      query: {
        studentProfile: {
          findFirst: vi.fn(async () => ({ status: "PUBLISHED" })),
        },
      },
    };

    const result = await submitForReview(db as never, "user-1", "profile-1");
    expect(result.success).toBe(false);
  });
});
