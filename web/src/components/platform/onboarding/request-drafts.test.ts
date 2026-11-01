// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { fillForm, fromStoredDrafts, isPristine, mergeDrafts, readForm } from "./request-drafts";
import { EMPTY_DRAFT, type RequestDraft } from "./welcome-flow";

const MENTOR_TYPED: RequestDraft = { ...EMPTY_DRAFT, mentorNote: "Backend reviews", mentorLink: "example.org" };
const INSTITUTION_STORED = { note: "Junior engineers", organisation: "Mto Labs", organisationRole: "", link: "", scopeAcknowledged: true };

function form(html: string) {
  const element = document.createElement("form");
  element.innerHTML = html;
  return element;
}

describe("request drafts", () => {
  it("calls a form pristine only when nothing at all is in it", () => {
    expect(isPristine(EMPTY_DRAFT)).toBe(true);
    expect(isPristine({ ...EMPTY_DRAFT, scope: true })).toBe(false);
    expect(isPristine(MENTOR_TYPED)).toBe(false);
  });

  it("stores the roles on screen and keeps another role's stored text", () => {
    expect(mergeDrafts({ INSTITUTION: INSTITUTION_STORED }, MENTOR_TYPED, ["MENTOR"])).toEqual({
      MENTOR: { note: "Backend reviews", link: "example.org" },
      INSTITUTION: INSTITUTION_STORED,
    });
  });

  it("forgets only the roles being sent", () => {
    const stored = { MENTOR: { note: "a", link: "" }, INSTITUTION: INSTITUTION_STORED };
    expect(mergeDrafts(stored, MENTOR_TYPED, ["MENTOR"], true)).toEqual({ INSTITUTION: INSTITUTION_STORED });
  });

  it("round-trips through the stored shape", () => {
    const draft: RequestDraft = {
      mentorNote: "m", mentorLink: "ml", organisation: "o", organisationRole: "r", institutionNote: "n", institutionLink: "l", scope: true,
    };
    expect(fromStoredDrafts(mergeDrafts({}, draft, ["MENTOR", "INSTITUTION"]))).toEqual(draft);
    expect(fromStoredDrafts({})).toEqual(EMPTY_DRAFT);
  });

  it("reads and fills only the controls the form has", () => {
    const element = form('<textarea name="mentorNote"></textarea><input name="mentorLink"><input type="checkbox" name="scope" value="yes">');
    fillForm(element, { ...EMPTY_DRAFT, mentorNote: "Backend reviews", organisation: "Not shown", scope: true });
    expect(readForm(element)).toEqual({ ...EMPTY_DRAFT, mentorNote: "Backend reviews", scope: true });
  });
});
