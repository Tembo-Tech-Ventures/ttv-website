import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { z as z4 } from "zod/v4";
import {
  communityRequest,
  mapJourney,
  mapProfile,
  searchProfiles,
  saveContribution,
  confirmContribution,
  askProfile,
} from "./community-client";
import { UiApiError, displayUiError } from "../discovery/ui-errors";
import { canOpenWorkspace } from "./CommunityApp";

const profile = {
  userId: "member",
  name: "Fictional Member",
  image: null,
  headline: "Builder",
  bio: "Builds tools",
  skills: ["React"],
  opportunityGoals: "An apprenticeship",
  version: 2,
  updatedAt: 123,
};
const entry = {
  id: "entry",
  userId: "member",
  title: "Library",
  description: "Built the library flow",
  occurredAt: "2026-10-24",
  evidenceUrl: "https://example.com/library",
  version: 3,
  visibility: "institution" as const,
  confirmations: [
    {
      id: "confirmation",
      mentorName: "Mentor",
      statement: "Reviewed the implementation",
      method: "Paired review",
      journeyVersion: 2,
      createdAt: 1_792_800_000,
    },
  ],
};
function respond(data: unknown, status = 200) {
  const fetcher = vi
    .fn()
    .mockResolvedValue(new Response(JSON.stringify(data), { status }));
  vi.stubGlobal("fetch", fetcher);
  return fetcher;
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("community API boundary", () => {
  it("requires same-origin credentials and validates the response", async () => {
    const fetcher = respond({ ok: true });
    expect(
      await communityRequest("access", z.object({ ok: z.boolean() })),
    ).toEqual({ ok: true });
    expect(fetcher).toHaveBeenCalledWith(
      "/api/community/access",
      expect.objectContaining({
        credentials: "same-origin",
        cache: "no-store",
        signal: expect.any(AbortSignal),
      }),
    );
    respond({ ok: "unexpected" });
    await expect(
      communityRequest("access", z.object({ ok: z.boolean() })),
    ).rejects.toMatchObject({ status: 502 });
  });
  it.each([401, 403, 409, 429, 503])(
    "shows safe status %s without raw service errors",
    async (status) => {
      respond({ error: "secret database detail" }, status);
      try {
        await communityRequest("profile", z.unknown());
        throw new Error("expected rejection");
      } catch (error) {
        expect(error).toBeInstanceOf(UiApiError);
        expect(displayUiError(error, "Fallback")).not.toContain("secret");
      }
    },
  );
  it("accepts schema defaults and transforms through the structural parser contract", async () => {
    respond({});
    const schema = z
      .object({ count: z.number().default(2) })
      .transform((data) => ({ label: String(data.count) }));
    expect(await communityRequest("profile", schema)).toEqual({ label: "2" });
  });
  it("accepts Zod 4 schema output through the same parser contract", async () => {
    respond({});
    const schema = z4
      .object({ count: z4.number().default(3) })
      .transform((data) => ({ label: String(data.count) }));
    expect(await communityRequest("profile", schema)).toEqual({ label: "3" });
  });
  it("does not expose transport failure details", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("private transport detail")),
    );
    await expect(
      communityRequest("profile", z.unknown()),
    ).rejects.toMatchObject({ status: 500 });
  });
  it("keeps profile metadata distinct from loaded evidence and preserves revisions", () => {
    expect(mapProfile(profile).evidenceLoaded).toBe(false);
    expect(mapProfile(profile, [entry]).evidenceLoaded).toBe(true);
    expect(mapJourney(entry)).toMatchObject({
      version: 3,
      confirmations: [{ journeyVersion: 2, method: "Paired review" }],
    });
  });
  it("does not turn empty saved profile fields into editable placeholder content", () => {
    const mapped = mapProfile({
      ...profile,
      headline: "",
      opportunityGoals: "",
    });
    expect(mapped.headline).toBe("");
    expect(mapped.goal).toBe("");
  });
  it("sends both search filters to the server before the limit", async () => {
    const fetcher = respond({ profiles: [profile] });
    const profiles = await searchProfiles({
      query: "Member",
      skills: "React, TypeScript",
      context: "A role",
    });
    const url = new URL(fetcher.mock.calls[0][0], "https://example.com");
    expect(url.searchParams.get("query")).toBe("Member");
    expect(url.searchParams.get("skills")).toBe("React, TypeScript");
    expect(profiles[0].evidenceLoaded).toBe(false);
  });
  it("publishes only supported contribution fields", async () => {
    const fetcher = respond({ entry });
    await saveContribution({
      title: "Library",
      description: "Built the library flow",
      date: "2026-10-24",
      sourceUrl: "https://example.com/library",
    });
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual({
      title: "Library",
      description: "Built the library flow",
      occurredAt: "2026-10-24",
      evidenceUrl: "https://example.com/library",
      visibility: "institution",
    });
  });
  it("binds mentor confirmation to the reviewed revision", async () => {
    const fetcher = respond({
      confirmation: { id: "confirmation", journeyVersion: 3 },
    });
    await confirmContribution("entry", {
      decision: "confirmed",
      note: "Reviewed implementation",
      method: "Paired review",
      expectedRevision: 3,
    });
    expect(JSON.parse(fetcher.mock.calls[0][1].body).expectedRevision).toBe(3);
  });
  it("uses structured profile chat scope and member-attached cited sources", async () => {
    const fetcher = respond({
      answer: "Evidence summary",
      aiGenerated: true,
      grounded: true,
      limited: false,
      citations: [
        {
          kind: "journey",
          id: "entry",
          userId: "member",
          version: 3,
          url: "https://untrusted.example",
        },
      ],
    });
    const answer = await askProfile(
      mapProfile(profile, [entry]),
      "What changed?",
      { query: "", skills: "React", context: "Apprenticeship" },
    );
    expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({
      message: "What changed?",
      profileId: "member",
      context: "Apprenticeship\nSkills of interest: React",
    });
    expect(answer.sources[0].url).toBe(entry.evidenceUrl);
  });
  it.each([
    { kind: "journey", id: "entry", userId: "other", version: 3 },
    { kind: "journey", id: "entry", userId: "member", version: 2 },
    { kind: "profile", id: "member", userId: "member", version: 1 },
  ])("rejects out-of-scope or stale citation %j", async (citation) => {
    respond({
      answer: "Summary",
      aiGenerated: true,
      grounded: true,
      limited: false,
      citations: [citation],
    });
    await expect(
      askProfile(mapProfile(profile, [entry]), "Question", {
        context: "",
        skills: "",
        query: "",
      }),
    ).rejects.toMatchObject({ status: 502 });
  });
  it("rejects stale mentor citations and accepts only the current revision", async () => {
    const citation = {
      kind: "confirmation",
      id: "confirmation",
      userId: "member",
      version: 2,
    };
    respond({
      answer: "Reviewed work",
      aiGenerated: true,
      grounded: true,
      limited: false,
      citations: [citation],
    });
    await expect(
      askProfile(mapProfile(profile, [entry]), "Question", {
        query: "",
        context: "",
        skills: "",
      }),
    ).rejects.toMatchObject({ status: 502 });
    respond({
      answer: "Reviewed work",
      aiGenerated: true,
      grounded: true,
      limited: false,
      citations: [{ ...citation, version: 3 }],
    });
    const answer = await askProfile(
      mapProfile(profile, [
        {
          ...entry,
          confirmations: [{ ...entry.confirmations[0], journeyVersion: 3 }],
        },
      ]),
      "Question",
      { query: "", context: "", skills: "" },
    );
    expect(answer.references).toEqual([
      "Mentor confirmation of Library · Revision 3",
    ]);
  });
  it("does not show an ungrounded answer as a supported personal claim", async () => {
    respond({
      answer: "Unsupported personal claim",
      aiGenerated: true,
      grounded: false,
      limited: false,
      citations: [],
    });
    const answer = await askProfile(mapProfile(profile, [entry]), "Question", {
      query: "",
      context: "",
      skills: "",
    });
    expect(answer.text).not.toContain("Unsupported personal claim");
    expect(answer.limited).toBe(true);
  });
  it("does not confuse mentor and institutional permissions", () => {
    const access = { isAdmin: false, isMentor: true, isInstitution: false };
    expect(canOpenWorkspace("journey", access)).toBe(true);
    expect(canOpenWorkspace("mentor", access)).toBe(true);
    expect(canOpenWorkspace("scout", access)).toBe(false);
    expect(canOpenWorkspace("scout", { ...access, isAdmin: true })).toBe(true);
  });
});
