// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FAILURES, FIELD_ERRORS, REQUEST } from "./copy";
import AccessRequestForm, { SUMMARY_ID, fieldId } from "./AccessRequestForm";
import { EMPTY_DRAFT } from "./welcome-flow";

type Props = ComponentProps<typeof AccessRequestForm>;
const props = (overrides: Partial<Props> = {}): Props => ({
  action: "/dashboard/welcome?step=request", roles: ["MENTOR"], draft: EMPTY_DRAFT, errors: {}, failure: null, draftKey: "ttv-onboarding-drafts:wairimu", ...overrides,
});

function html(overrides: Partial<Props> = {}) {
  const container = document.createElement("div");
  container.innerHTML = renderToString(<AccessRequestForm {...props(overrides)} />);
  return container;
}

const label = (page: HTMLElement, field: Parameters<typeof fieldId>[0]) =>
  page.querySelector(`label[for=${fieldId(field)}]`)?.textContent;

describe("AccessRequestForm, as the server sends it", () => {
  it("asks a mentor for the work they could review and an optional link", () => {
    const page = html();
    expect(page.querySelector("form")?.getAttribute("action")).toBe("/dashboard/welcome?step=request");
    expect(page.querySelector("h2")?.textContent).toBe(REQUEST.sections.MENTOR);
    expect(label(page, "mentorNote")).toBe(REQUEST.mentorNote);
    expect(label(page, "mentorLink")).toBe(`${REQUEST.mentorLink} ${REQUEST.optional}`);
    const note = page.querySelector<HTMLTextAreaElement>(`#${fieldId("mentorNote")}`)!;
    expect(note.required).toBe(true);
    expect(note.maxLength).toBe(600);
    expect(page.querySelector(`#${fieldId("organisation")}`)).toBeNull();
    expect(page.querySelector("button[type=submit]")?.textContent).toBe(REQUEST.send);
  });

  it("asks an organisation for its name, purpose and the scope acknowledgement", () => {
    const page = html({ roles: ["INSTITUTION"] });
    expect(page.querySelector("h2")?.textContent).toBe(REQUEST.sections.INSTITUTION);
    expect(label(page, "organisation")).toBe(REQUEST.organisation);
    expect(label(page, "organisationRole")).toBe(`${REQUEST.organisationRole} ${REQUEST.optional}`);
    expect(label(page, "institutionNote")).toBe(REQUEST.institutionNote);
    expect(label(page, "institutionLink")).toBe(`${REQUEST.institutionLink} ${REQUEST.optional}`);
    const scope = page.querySelector<HTMLInputElement>(`#${fieldId("scope")}`)!;
    expect([scope.type, scope.name, scope.value, scope.required]).toEqual(["checkbox", "scope", "yes", true]);
    expect(scope.closest("label")?.textContent).toBe(REQUEST.scope);
  });

  it("puts both requests in one form with one button when both were chosen", () => {
    const page = html({ roles: ["MENTOR", "INSTITUTION"] });
    expect(Array.from(page.querySelectorAll("h2")).map((h) => h.textContent)).toEqual([REQUEST.sections.MENTOR, REQUEST.sections.INSTITUTION]);
    expect(page.querySelectorAll("button[type=submit]")).toHaveLength(1);
    expect(page.querySelector("button[type=submit]")?.textContent).toBe(REQUEST.sendBoth);
  });

  it("gives back what was typed, as text", () => {
    const draft = { ...EMPTY_DRAFT, organisation: "<b>Mto</b> Labs", institutionNote: "Junior <script>alert(1)</script> engineers", scope: true };
    const page = html({ roles: ["INSTITUTION"], draft });
    expect(page.querySelector<HTMLInputElement>(`#${fieldId("organisation")}`)?.value).toBe("<b>Mto</b> Labs");
    expect(page.querySelector<HTMLTextAreaElement>(`#${fieldId("institutionNote")}`)?.value).toBe("Junior <script>alert(1)</script> engineers");
    expect(page.querySelector("script, b")).toBeNull();
    expect(page.querySelector<HTMLInputElement>(`#${fieldId("scope")}`)?.hasAttribute("checked")).toBe(true);
  });

  it("lists each problem with a link to its field, takes focus, and marks the fields", () => {
    const errors = { organisation: FIELD_ERRORS.organisation, scope: FIELD_ERRORS.scope };
    const page = html({ roles: ["INSTITUTION"], errors });
    const summary = page.querySelector(`#${SUMMARY_ID}`)!;
    expect(summary.hasAttribute("autofocus")).toBe(true);
    expect(Array.from(summary.querySelectorAll("a")).map((a) => [a.getAttribute("href"), a.textContent])).toEqual([
      [`#${fieldId("organisation")}`, FIELD_ERRORS.organisation],
      [`#${fieldId("scope")}`, FIELD_ERRORS.scope],
    ]);
    const organisation = page.querySelector(`#${fieldId("organisation")}`)!;
    expect(organisation.getAttribute("aria-invalid")).toBe("true");
    expect(page.querySelector(`#${organisation.getAttribute("aria-describedby")}`)?.textContent).toBe(FIELD_ERRORS.organisation);
    expect(page.querySelector(`#${fieldId("organisationRole")}`)?.hasAttribute("aria-invalid")).toBe(false);
  });

  it("says why nothing was sent when the answers were fine", () => {
    const summary = html({ failure: FAILURES.rateLimited }).querySelector(`#${SUMMARY_ID}`)!;
    expect(summary.textContent).toBe(FAILURES.rateLimited);
    expect(summary.querySelector("a")).toBeNull();
  });

  it("has nothing in the way of the first field when all is well", () => {
    expect(html().querySelector(`#${SUMMARY_ID}`)).toBeNull();
    expect(html().querySelector("[autofocus]")).toBeNull();
  });

  it("describes a note's length rule to screen readers, and shows no counter until it can count", () => {
    const page = html();
    const note = page.querySelector(`#${fieldId("mentorNote")}`)!;
    expect(page.querySelector(`#${note.getAttribute("aria-describedby")}`)?.textContent).toContain(REQUEST.noteLength);
    expect(page.textContent).not.toContain("/ 600");
  });

  it("tells the person who reads their request", () => {
    expect(html().textContent).toContain(REQUEST.privacy);
  });
});

describe("AccessRequestForm, hydrated", () => {
  let root: Root;
  let container: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.unstubAllGlobals();
  });

  it("counts each note's characters as they are typed", async () => {
    await act(async () => root.render(<AccessRequestForm {...props({ roles: ["MENTOR", "INSTITUTION"], draft: { ...EMPTY_DRAFT, mentorNote: "abc" } })} />));
    const counters = () => Array.from(container.querySelectorAll(".request-field__counter")).map((c) => c.textContent);
    expect(counters()).toEqual(["3 / 600", "0 / 600"]);
    const note = container.querySelector<HTMLTextAreaElement>(`#${fieldId("institutionNote")}`)!;
    act(() => {
      note.value = "Junior engineers";
      note.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(counters()).toEqual(["3 / 600", "16 / 600"]);
  });

  const KEY = "ttv-onboarding-drafts:wairimu";
  const stored = () => JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as Record<string, unknown>;
  const type = (field: Parameters<typeof fieldId>[0], value: string) => {
    const control = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(`#${fieldId(field)}`)!;
    act(() => {
      control.value = value;
      control.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("keeps unsent text for this tab, and gives it back to a fresh form", async () => {
    sessionStorage.clear();
    await act(async () => root.render(<AccessRequestForm {...props()} />));
    type("mentorNote", "Backend and data reviews");
    expect(stored()).toEqual({ MENTOR: { note: "Backend and data reviews", link: "" } });

    await act(async () => root.unmount());
    root = createRoot(container);
    await act(async () => root.render(<AccessRequestForm {...props()} />));
    expect(container.querySelector<HTMLTextAreaElement>(`#${fieldId("mentorNote")}`)?.value).toBe("Backend and data reviews");
    expect(container.querySelector(".request-field__counter")?.textContent).toBe("24 / 600");
  });

  it("lets what the server sent back win over a stored draft", async () => {
    sessionStorage.setItem(KEY, JSON.stringify({ MENTOR: { note: "An older draft of mine", link: "" } }));
    await act(async () => root.render(<AccessRequestForm {...props({ draft: { ...EMPTY_DRAFT, mentorNote: "Too short" } })} />));
    expect(container.querySelector<HTMLTextAreaElement>(`#${fieldId("mentorNote")}`)?.value).toBe("Too short");
  });

  it("forgets the sent roles' drafts as the form goes, keeping any other role's", async () => {
    sessionStorage.setItem(KEY, JSON.stringify({
      INSTITUTION: { note: "Junior engineers", organisation: "Mto Labs", organisationRole: "", link: "", scopeAcknowledged: false },
    }));
    await act(async () => root.render(<AccessRequestForm {...props()} />));
    type("mentorNote", "Backend and data reviews");
    act(() => {
      container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    expect(Object.keys(stored())).toEqual(["INSTITUTION"]);
  });

  it("sends once, however many times the button is pressed", async () => {
    await act(async () => root.render(<AccessRequestForm {...props()} />));
    const form = container.querySelector("form")!;
    const submit = () => {
      const event = new Event("submit", { bubbles: true, cancelable: true });
      act(() => {
        form.dispatchEvent(event);
      });
      return !event.defaultPrevented;
    };
    expect(submit()).toBe(true);
    expect(form.querySelector("button")?.getAttribute("aria-disabled")).toBe("true");
    expect(submit()).toBe(false);
  });
});
