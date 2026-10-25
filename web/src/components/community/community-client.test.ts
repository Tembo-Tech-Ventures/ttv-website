import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { z as z4 } from "zod/v4";
import {
  communityRequest,
  mapJourney,
  loadMentorship,
  mapProfile,
  searchProfiles,
  saveContribution,
  updateContribution,
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
      mentorRole: "MENTOR" as const,
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
  it("preserves confirmation history and role snapshots in the mentor list", async () => {
    respond({
      entries: [
        {
          ...entry,
          memberName: "Fictional Member",
          reviewedByCurrentMentor: true,
          confirmations: [{ ...entry.confirmations[0], mentorRole: "ADMIN" }],
        },
      ],
    });
    const requests = await loadMentorship();
    expect(requests[0].status).toBe("confirmed");
    expect(requests[0].confirmations?.[0]).toMatchObject({
      mentorRole: "ADMIN",
      journeyVersion: 2,
    });
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
  it("rejects a confirmation response for a different revision without retrying", async () => {
    const fetcher = respond({
      confirmation: { id: "confirmation", journeyVersion: 4 },
    });
    await expect(
      confirmContribution("entry", {
        decision: "confirmed",
        note: "Reviewed implementation",
        method: "Paired review",
        expectedRevision: 3,
      }),
    ).rejects.toMatchObject({ status: 502 });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("does not retry a stale confirmation automatically", async () => {
    const fetcher = respond({}, 409);
    await expect(
      confirmContribution("entry", {
        decision: "confirmed",
        note: "Reviewed implementation",
        method: "Paired review",
        expectedRevision: 3,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(fetcher).toHaveBeenCalledTimes(1);
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
    expect(answer.references).toEqual(["Confirmation of Library · Revision 3"]);
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


describe("chat request deadline", () => {
  it("allows a valid multi-step chat response after the ordinary request deadline", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return new Promise<Response>(resolve => { setTimeout(() => resolve(Response.json({
        answer: "Published contribution", aiGenerated: true, grounded: true, limited: false,
        citations: [{ kind: "journey", id: "entry", userId: "member", version: 3 }],
      })), 60_000); });
    });
    vi.stubGlobal("fetch", fetcher);
    const pending = askProfile(mapProfile(profile, [entry]), "Explain this work", { query: "", context: "", skills: "" });
    await vi.advanceTimersByTimeAsync(25_000);
    expect(signal?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(35_000);
    expect((await pending).text).toBe("Published contribution");
    expect(fetcher).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each([["chat", "POST", 70_000], ["profile", "GET", 25_000], ["profile", "PUT", 25_000]])(
    "still aborts %s %s at its bounded deadline without retry", async (path, method, deadline) => {
      vi.useFakeTimers();
      const fetcher = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("Private transport details")), { once: true });
      }));
      const pending = communityRequest(path as string, z.object({ ok: z.boolean() }), method as string, undefined, fetcher);
      const settled = pending.catch(error => error);
      await vi.advanceTimersByTimeAsync((deadline as number) - 1);
      expect(fetcher.mock.calls[0][1]?.signal?.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      expect(await settled).toEqual(new UiApiError(500));
      expect(fetcher).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );
});

it('updates the loaded own revision without republishing private work or dropping historical confirmations',async()=>{
 const current={...entry,visibility:'private' as const};const fetcher=vi.fn().mockResolvedValueOnce(Response.json({id:entry.id,updated:true})).mockResolvedValueOnce(Response.json({entries:[{...current,version:4,title:'Updated title'}]}));vi.stubGlobal('fetch',fetcher);
 const saved=await updateContribution(mapJourney(current),{title:'Updated title',description:'Updated contribution details',date:'2026-10-20',sourceUrl:''});
 expect(fetcher.mock.calls[0][0]).toBe('/api/community/journey/'+encodeURIComponent(entry.id));expect(fetcher.mock.calls[0][1].method).toBe('PUT');expect(JSON.parse(fetcher.mock.calls[0][1].body)).toMatchObject({visibility:'private',expectedRevision:3});expect(saved.version).toBe(4);expect(saved.confirmations[0].journeyVersion).toBe(2);
});
it('surfaces a stale-edit conflict before any refresh read',async()=>{
 const fetcher=respond({},409);await expect(updateContribution(mapJourney(entry),{title:'Updated title',description:'Updated contribution details',date:'2026-10-20',sourceUrl:''})).rejects.toMatchObject({status:409});expect(fetcher).toHaveBeenCalledOnce();
});
