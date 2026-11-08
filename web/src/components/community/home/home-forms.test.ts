import { describe, expect, it, vi } from "vitest";
import type { JourneyClaim } from "@/components/discovery/types";
import {
  addHref, editHref, editorFromUrl, handleCommunityHomePost, parseSkills, profileHref, validateContribution, validateProfile,
  type CommunityWrite,
} from "./home-forms";

const ORIGIN = "https://ttv.invalid";
const PAGE = `${ORIGIN}/dashboard/community`;
const claim = (overrides: Partial<JourneyClaim> = {}): JourneyClaim => ({
  id: "ledger", title: "Chama savings ledger", description: "Built and tested a fictional savings ledger.", date: "2026-10-24",
  skills: [], evidence: [], version: 3, visibility: "private", confirmations: [], ...overrides,
});
const CONTRIBUTION = { form: "contribution", title: "Matatu fare splitter", description: "Wrote the fare-splitting logic and its tests.", date: "2026-10-30", sourceUrl: "" };
const post = (form: Record<string, string>, origin: string | null = ORIGIN) =>
  new Request(PAGE, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...(origin ? { origin } : {}) },
    body: new URLSearchParams(form).toString(),
  });

describe("which editor the address opens", () => {
  const claims = [claim()];
  it.each([
    ["", null],
    ["?add=1", { kind: "add" }],
    ["?profile=edit", { kind: "profile" }],
    ["?edit=ledger", { kind: "edit", claim: claims[0] }],
    ["?edit=someone-elses", null],
    ["?edit=ledger&add=1", { kind: "edit", claim: claims[0] }],
  ])("%s", (search, editor) => {
    expect(editorFromUrl(new URL(`${PAGE}${search}`), claims)).toEqual(editor);
  });

  it("links to each without a fragment-dependent action", () => {
    expect(addHref()).toBe("/dashboard/community?add=1#contribution-editor");
    expect(editHref({ id: "a b" })).toBe("/dashboard/community?edit=a%20b#contribution-editor");
    expect(profileHref()).toBe("/dashboard/community?profile=edit#profile-editor");
  });
});

describe("a contribution's checks", () => {
  it("passes a complete entry", () => {
    expect(validateContribution({ title: "Ledger", description: "Built the reconciliation flow.", date: "2026-10-24", sourceUrl: "https://github.com/example/ledger" })).toEqual({});
  });

  it("explains each problem under its field", () => {
    expect(validateContribution({ title: " ab ", description: "short", date: "2026-02-30", sourceUrl: "http://example.test" })).toEqual({
      title: "Give this entry a title of at least 3 characters.",
      description: "Describe your contribution in at least 20 characters.",
      date: "Choose a date for this contribution.",
      sourceUrl: "Use a public HTTPS link without credentials or private application paths.",
    });
    expect(validateContribution({ title: "x".repeat(161), description: "y".repeat(6001), date: "", sourceUrl: "not a link" })).toEqual({
      title: "Keep the title within 160 characters.",
      description: "Keep the contribution within 6,000 characters.",
      date: "Choose a date for this contribution.",
      sourceUrl: "Use a complete public HTTPS link for your source.",
    });
  });

  it.each(["https://user:pass@example.test/", "https://ttv.example/dashboard/me", "https://ttv.example/api/x"])("refuses a private or credentialed source: %s", (sourceUrl) => {
    expect(validateContribution({ title: "Ledger", description: "Built the reconciliation flow.", date: "2026-10-24", sourceUrl }).sourceUrl).toBeDefined();
  });
});

describe("the profile's checks", () => {
  it("reads skills as a comma-separated list", () => {
    expect(parseSkills(" TypeScript, ,SQL ,")).toEqual(["TypeScript", "SQL"]);
  });

  it("explains each limit", () => {
    expect(validateProfile({ headline: "h".repeat(161), bio: "b".repeat(4001), skills: Array.from({ length: 31 }, (_, i) => `s${i}`).join(","), opportunityGoals: "g".repeat(2001) })).toEqual({
      headline: "Keep your headline within 160 characters.",
      bio: "Keep the description of your work within 4,000 characters.",
      skills: "Add no more than 30 skills.",
      opportunityGoals: "Keep your opportunity goals within 2,000 characters.",
    });
    expect(validateProfile({ headline: "", bio: "", skills: "x".repeat(61), opportunityGoals: "" })).toEqual({ skills: "Keep each skill within 60 characters." });
  });
});

describe("a post to Community", () => {
  const ok = () => vi.fn(async (_write: CommunityWrite) => Response.json({}, { status: 201 }));

  it("adds a contribution as the API's own call, shared with institutions", async () => {
    const send = ok();
    expect(await handleCommunityHomePost(post(CONTRIBUTION), [], send)).toEqual({ kind: "saved", saved: "added" });
    expect(send).toHaveBeenCalledWith({
      path: "journey", method: "POST",
      body: { title: "Matatu fare splitter", description: "Wrote the fare-splitting logic and its tests.", evidenceUrl: null, occurredAt: "2026-10-30", visibility: "institution" },
    });
  });

  it("revises a contribution at the revision it was opened at, keeping its visibility", async () => {
    const send = ok();
    const result = await handleCommunityHomePost(post({ ...CONTRIBUTION, id: "ledger", revision: "3", sourceUrl: " https://github.com/example/fares " }), [claim()], send);
    expect(result).toEqual({ kind: "saved", saved: "updated" });
    expect(send.mock.calls[0]?.[0]).toEqual({
      path: "journey/ledger", method: "PUT",
      body: { title: "Matatu fare splitter", description: "Wrote the fare-splitting logic and its tests.", evidenceUrl: "https://github.com/example/fares", occurredAt: "2026-10-30", visibility: "private", expectedRevision: 3 },
    });
  });

  it("saves the profile with its skills listed once each by the API", async () => {
    const send = ok();
    await handleCommunityHomePost(post({ form: "profile", headline: " Builder ", bio: "", skills: "TypeScript, SQL", opportunityGoals: "" }), [], send);
    expect(send.mock.calls[0]?.[0]).toEqual({ path: "profile", method: "PUT", body: { headline: "Builder", bio: "", skills: ["TypeScript", "SQL"], opportunityGoals: "" } });
  });

  it("refuses another origin, or none, before reading the form", async () => {
    const send = ok();
    expect(await handleCommunityHomePost(post(CONTRIBUTION, "https://elsewhere.example"), [], send)).toEqual({ kind: "refuse", status: 403 });
    expect(await handleCommunityHomePost(post(CONTRIBUTION, null), [], send)).toEqual({ kind: "refuse", status: 403 });
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses a form it can't read", async () => {
    expect(await handleCommunityHomePost(post({ form: "something-else" }), [], ok())).toEqual({ kind: "refuse", status: 400 });
    const huge = post({ ...CONTRIBUTION, description: "x".repeat(40_000) });
    expect(await handleCommunityHomePost(huge, [], ok())).toEqual({ kind: "refuse", status: 413 });
  });

  it("answers its own checks with a 400 and sends nothing", async () => {
    const send = ok();
    const result = await handleCommunityHomePost(post({ ...CONTRIBUTION, title: "" }), [], send);
    expect(result).toMatchObject({ kind: "render", status: 400, failure: null, render: { form: "contribution", errors: { title: expect.any(String) } } });
    expect(send).not.toHaveBeenCalled();
  });

  it("says a contribution changed when it is gone or its revision is stale", async () => {
    const gone = await handleCommunityHomePost(post({ ...CONTRIBUTION, id: "missing", revision: "1" }), [claim()], ok());
    expect(gone).toMatchObject({ kind: "render", status: 409, failure: { title: "This contribution changed since you opened it" } });
    const stale = await handleCommunityHomePost(post({ ...CONTRIBUTION, id: "ledger", revision: "2" }), [claim()], async () => Response.json({ error: "Contribution changed." }, { status: 409 }));
    expect(stale).toMatchObject({ kind: "render", status: 409, render: { values: { title: "Matatu fare splitter" } } });
  });

  it("answers a database failure with a 503, whether the API answers or throws", async () => {
    for (const send of [async () => Response.json({ error: "x" }, { status: 500 }), async () => { throw new Error("down"); }]) {
      expect(await handleCommunityHomePost(post({ form: "profile", headline: "Kept", bio: "", skills: "", opportunityGoals: "" }), [], send))
        .toMatchObject({ kind: "render", status: 503, failure: { title: "Couldn't save your profile" }, render: { values: { headline: "Kept" } } });
    }
  });

  it("passes on a refusal it could not foresee in the API's own words", async () => {
    const result = await handleCommunityHomePost(post(CONTRIBUTION), [], async () => Response.json({ error: "Read-only synthetic probe." }, { status: 403 }));
    expect(result).toMatchObject({ kind: "render", status: 403, failure: { detail: "Read-only synthetic probe. Everything you wrote is still here." } });
  });
});
