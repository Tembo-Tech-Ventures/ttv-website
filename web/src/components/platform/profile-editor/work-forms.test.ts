import { describe, expect, it, vi } from "vitest";
import type { JourneyClaim } from "@/components/discovery/types";
import { SPACE_PAGE_PATHS } from "@/components/platform/spaces/sidebar";
import {
  addWorkHref, confirmDeleteHref, deleteAction, EDITOR_PATH, editWorkHref, handleWorkPost, isContribution, profileFormHref, readEditorPost,
  validateWork, workEditorFromUrl, workListHref, workValuesOf, type WorkAction, type WorkWrite,
} from "./work-forms";

const ORIGIN = "https://ttv.invalid";
const PAGE = `${ORIGIN}${EDITOR_PATH}`;
const claim = (overrides: Partial<JourneyClaim> = {}): JourneyClaim => ({
  id: "ledger", title: "Chama savings ledger", description: "Built and tested a fictional savings ledger.", date: "2026-10-24",
  skills: [], evidence: [], version: 3, status: "posted", confirmations: [], kind: "contribution", repoFullName: null, ...overrides,
});
const repo = claim({ id: "mpesa", kind: "repo", repoFullName: "achieng-otieno/mpesa-callbacks" });
const WORK = { _action: "work", title: "Matatu fare splitter", description: "Wrote the fare-splitting logic and its tests.", date: "2026-10-30", link: "", status: "posted" };
const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};
const post = (fields: Record<string, string>, origin: string | null = ORIGIN) =>
  new Request(PAGE, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...(origin ? { origin } : {}) },
    body: new URLSearchParams(fields).toString(),
  });
const ok = () => vi.fn(async (_write: WorkWrite) => Response.json({}, { status: 201 }));
const run = (action: WorkAction, fields: Record<string, string>, claims: JourneyClaim[] = [claim(), repo], send = ok()) =>
  handleWorkPost(action, form(fields), claims, send);

describe("the editor's addresses", () => {
  it("is the Profile space's editor, and links to each form without a script", () => {
    expect(EDITOR_PATH).toBe(SPACE_PAGE_PATHS.portfolio);
    expect(addWorkHref()).toBe("/dashboard/me/portfolio?add=1#work-editor");
    expect(editWorkHref({ id: "a b" })).toBe("/dashboard/me/portfolio?edit=a%20b#work-editor");
    expect(profileFormHref()).toBe("/dashboard/me/portfolio#profile-form");
    // The confirm step's address carries no fragment, so its warning takes focus.
    expect(confirmDeleteHref({ id: "ledger" })).toBe("/dashboard/me/portfolio?confirm=delete-ledger");
    expect(deleteAction({ id: "ledger" })).toBe("delete-ledger");
    expect(workListHref()).toBe("/dashboard/me/portfolio#work");
  });

  it.each([
    ["", null],
    ["?add=1", { kind: "add" }],
    ["?edit=ledger", { kind: "edit", claim: claim() }],
    ["?edit=someone-elses", null],
    // A repository is the RepoPicker's: the work form never opens on one.
    ["?edit=mpesa", null],
    ["?edit=ledger&add=1", { kind: "edit", claim: claim() }],
  ])("opens %s", (search, editor) => {
    expect(workEditorFromUrl(new URL(`${PAGE}${search}`), [claim(), repo])).toEqual(editor);
  });

  it("tells a contribution from a repository", () => {
    expect(isContribution(claim())).toBe(true);
    expect(isContribution(repo)).toBe(false);
    expect(workValuesOf(claim({ evidence: [{ title: "Code", url: "https://github.com/example/ledger", kind: "code" }] as JourneyClaim["evidence"] })))
      .toEqual({ title: "Chama savings ledger", description: "Built and tested a fictional savings ledger.", date: "2026-10-24", link: "https://github.com/example/ledger", status: "posted" });
  });
});

describe("a piece of work's checks", () => {
  const valid = { title: "Ledger", description: "Built the reconciliation flow.", date: "2026-10-24", link: "https://github.com/example/ledger", status: "posted" as const };

  it("passes a complete piece, and one with no link", () => {
    expect(validateWork(valid)).toEqual({});
    expect(validateWork({ ...valid, link: "" })).toEqual({});
  });

  it("explains each problem under its field", () => {
    expect(validateWork({ ...valid, title: " ab ", description: "short", date: "2026-02-30", link: "http://example.test" })).toEqual({
      title: "Give it a title of at least 3 characters.",
      description: "Say what you did in at least 20 characters.",
      date: "Choose the date you did it.",
      link: "Use a public HTTPS link without a password in it, and not a page inside TTV.",
    });
    expect(validateWork({ ...valid, title: "x".repeat(161), description: "y".repeat(6001), date: "", link: "not a link" })).toEqual({
      title: "Keep the title within 160 characters.",
      description: "Keep the description within 6,000 characters.",
      date: "Choose the date you did it.",
      link: "Use a complete link that starts with https://.",
    });
  });

  it.each(["https://user:pass@example.test/", "https://ttv.example/dashboard/me", "https://ttv.example/api/x"])("refuses a private or credentialed link: %s", (link) => {
    expect(validateWork({ ...valid, link }).link).toBeDefined();
  });
});

describe("posting work", () => {
  it("posts a new piece as the API's own call, or keeps it as a draft", async () => {
    const send = ok();
    expect(await run("work", WORK, [], send)).toEqual({ kind: "saved", saved: "added", held: false });
    expect(send).toHaveBeenCalledWith({
      path: "journey", method: "POST",
      body: { title: "Matatu fare splitter", description: "Wrote the fare-splitting logic and its tests.", evidenceUrl: null, occurredAt: "2026-10-30", status: "posted" },
    });
    const draft = ok();
    expect(await run("work", { ...WORK, status: "draft" }, [], draft)).toEqual({ kind: "saved", saved: "addedDraft" });
    expect(draft.mock.calls[0]?.[0]).toMatchObject({ body: { status: "draft" } });
  });

  it("says when the automatic check holds what was posted, from the API's reply to a post, an edit or a status change", async () => {
    const created = vi.fn(async () => Response.json({ entry: { id: "new", moderationHold: true } }, { status: 201 }));
    expect(await run("work", WORK, [], created)).toEqual({ kind: "saved", saved: "added", held: true });
    const revised = vi.fn(async () => Response.json({ id: "ledger", updated: true, moderationHold: true }));
    expect(await run("work", { ...WORK, id: "ledger", revision: "3" }, undefined, revised)).toEqual({ kind: "saved", saved: "updated", held: true });
    const posted = vi.fn(async () => Response.json({ id: "ledger", status: "posted", moderationHold: true }));
    expect(await run("work-status", { id: "ledger", status: "posted" }, undefined, posted)).toEqual({ kind: "saved", saved: "posted", held: true });
    // Nobody else sees a draft, so a check on one is not news.
    expect(await run("work", { ...WORK, status: "draft" }, [], created)).toEqual({ kind: "saved", saved: "addedDraft" });
  });

  it("says a moderator took work down, rather than that it changed, when the API refuses an edit for that", async () => {
    const result = await run("work", { ...WORK, id: "ledger", revision: "3" }, undefined, vi.fn(async () => Response.json({ error: "A moderator took this down." }, { status: 409 })));
    expect(result).toMatchObject({ kind: "render", status: 409, failure: { detail: "A moderator took this down, so it can't be changed. You can delete it." } });
  });

  it("revises a piece at the revision it was opened at, with the status chosen", async () => {
    const send = ok();
    const result = await run("work", { ...WORK, id: "ledger", revision: "3", link: " https://github.com/example/fares ", status: "draft" }, undefined, send);
    expect(result).toEqual({ kind: "saved", saved: "updated" });
    expect(send.mock.calls[0]?.[0]).toEqual({
      path: "journey/ledger", method: "PUT",
      body: { title: "Matatu fare splitter", description: "Wrote the fare-splitting logic and its tests.", evidenceUrl: "https://github.com/example/fares", occurredAt: "2026-10-30", status: "draft", expectedRevision: 3 },
    });
  });

  it("never edits a repository through the work form, or work that isn't the caller's", async () => {
    for (const id of ["mpesa", "someone-elses"]) {
      const send = ok();
      expect(await run("work", { ...WORK, id, revision: "1" }, undefined, send)).toMatchObject({ kind: "render", status: 409 });
      expect(send).not.toHaveBeenCalled();
    }
  });

  it("answers its own checks with a 400, keeps what was typed and sends nothing", async () => {
    const send = ok();
    const result = await run("work", { ...WORK, title: "" }, [], send);
    expect(result).toMatchObject({ kind: "render", status: 400, failure: null, claimId: null, values: { description: WORK.description }, errors: { title: expect.any(String) } });
    expect(send).not.toHaveBeenCalled();
  });

  it("says the work changed when its revision is stale", async () => {
    const stale = await run("work", { ...WORK, id: "ledger", revision: "2" }, undefined, vi.fn(async () => Response.json({ error: "Contribution changed." }, { status: 409 })));
    expect(stale).toMatchObject({ kind: "render", status: 409, claimId: "ledger", values: { title: "Matatu fare splitter" }, failure: { title: "Your work wasn't saved" } });
  });

  it("answers a database failure with a 503, whether the API answers or throws", async () => {
    for (const send of [vi.fn(async () => Response.json({ error: "x" }, { status: 500 })), vi.fn(async () => { throw new Error("down"); })]) {
      expect(await run("work", WORK, [], send)).toMatchObject({ kind: "render", status: 503, failure: { detail: "That didn't save, through no fault of yours. Try again in a moment." } });
    }
  });

  it("passes on a refusal it could not foresee in the API's own words", async () => {
    const result = await run("work", WORK, [], vi.fn(async () => Response.json({ error: "Read-only synthetic probe." }, { status: 403 })));
    expect(result).toMatchObject({ kind: "render", status: 403, failure: { detail: "Read-only synthetic probe. Everything you wrote is still here." } });
  });
});

describe("moving work between posted and draft, and deleting it", () => {
  it("posts a draft or moves posted work back to drafts", async () => {
    const send = ok();
    expect(await run("work-status", { id: "ledger", status: "draft" }, undefined, send)).toEqual({ kind: "saved", saved: "drafted" });
    expect(send).toHaveBeenCalledWith({ path: "journey/ledger", method: "PATCH", body: { status: "draft" } });
    expect(await run("work-status", { id: "ledger", status: "posted" })).toEqual({ kind: "saved", saved: "posted", held: false });
    expect(await run("work-status", { id: "ledger", status: "public" })).toEqual({ kind: "refuse", status: 400 });
  });

  it("deletes the caller's own piece, and says when it is gone", async () => {
    const send = ok();
    expect(await run("work-delete", { id: "ledger" }, undefined, send)).toEqual({ kind: "saved", saved: "deleted" });
    expect(send).toHaveBeenCalledWith({ path: "journey/ledger", method: "DELETE" });
    expect(await run("work-delete", { id: "ledger" }, undefined, vi.fn(async () => Response.json({ error: "Contribution not found." }, { status: 404 }))))
      .toMatchObject({ kind: "failed", status: 404, failure: { detail: "Contribution not found. Everything you wrote is still here." } });
  });

  it("never changes a repository, or work that isn't the caller's, and sends nothing", async () => {
    for (const [action, fields] of [["work-status", { id: "mpesa", status: "draft" }], ["work-delete", { id: "someone-elses" }]] as const) {
      const send = ok();
      expect(await run(action, fields, undefined, send)).toMatchObject({ kind: "failed", status: 409 });
      expect(send).not.toHaveBeenCalled();
    }
  });
});

describe("reading a post to the editor", () => {
  it("reads the action and the form", async () => {
    const read = await readEditorPost(post(WORK));
    expect("form" in read && read.action).toBe("work");
  });

  it("refuses another origin, or none, a form too large, and one with no action", async () => {
    expect(await readEditorPost(post(WORK, "https://elsewhere.example"))).toEqual({ refuse: 403 });
    expect(await readEditorPost(post(WORK, null))).toEqual({ refuse: 403 });
    expect(await readEditorPost(post({ ...WORK, description: "x".repeat(40_000) }))).toEqual({ refuse: 413 });
    expect(await readEditorPost(post({ title: "No action" }))).toEqual({ refuse: 400 });
  });
});
