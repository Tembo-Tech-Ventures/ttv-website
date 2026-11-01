// @vitest-environment happy-dom
import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WELCOME } from "./copy";
import WelcomeChoices, { CHOICES_ERROR_ID } from "./WelcomeChoices";

type Props = ComponentProps<typeof WelcomeChoices>;
const props = (overrides: Partial<Props> = {}): Props => ({
  action: "/dashboard/welcome", selected: [], statuses: {}, error: null, ...overrides,
});

function html(overrides: Partial<Props> = {}) {
  const container = document.createElement("div");
  container.innerHTML = renderToString(<WelcomeChoices {...props(overrides)} />);
  return container;
}

describe("WelcomeChoices, as the server sends it", () => {
  it("is a plain form posting to its own step, with one checkbox per card", () => {
    const page = html({ selected: ["MEMBER", "MENTOR"] });
    const form = page.querySelector("form")!;
    expect(form.getAttribute("method")).toBe("post");
    expect(form.getAttribute("action")).toBe("/dashboard/welcome");
    const boxes = Array.from(page.querySelectorAll<HTMLInputElement>("input[type=checkbox][name=intent]"));
    expect(boxes.map((box) => [box.value, box.hasAttribute("checked")])).toEqual([
      ["MEMBER", true], ["MENTOR", true], ["INSTITUTION", false],
    ]);
  });

  it("names each checkbox by its card's title and describes it by the card's words", () => {
    const page = html();
    const mentor = page.querySelector<HTMLInputElement>("input[value=MENTOR]")!;
    expect(page.querySelector(`#${CSS.escape(mentor.getAttribute("aria-labelledby")!)}`)?.textContent).toBe("Mentor");
    const description = mentor.getAttribute("aria-describedby")!.split(" ")
      .map((id) => page.querySelector(`#${CSS.escape(id)}`)?.textContent).join(" ");
    expect(description).toContain("Review work that members share");
    expect(description).toContain(WELCOME.needsApproval);
  });

  it("says what needs approval, and where a revisiting person already stands", () => {
    expect(html().textContent).toContain(WELCOME.open);
    const revisit = html({ statuses: { MENTOR: "pending", INSTITUTION: "active" } }).textContent!;
    expect(revisit).toContain(WELCOME.pending);
    expect(revisit).toContain(WELCOME.active);
    expect(revisit).not.toContain(WELCOME.needsApproval);
  });

  it("says before anything is sent that access waits for an administrator", () => {
    expect(html().textContent).toContain(WELCOME.info);
  });

  it("offers Continue and just looking around as two submit buttons of the same form", () => {
    const buttons = Array.from(html().querySelectorAll("form button"));
    expect(buttons.map((b) => [b.getAttribute("type"), b.getAttribute("name"), b.getAttribute("value"), b.textContent])).toEqual([
      ["submit", "action", "continue", WELCOME.continue],
      ["submit", "action", "explore", WELCOME.explore],
    ]);
  });

  it("shows no selection count it could not keep up to date", () => {
    expect(html({ selected: ["MEMBER"] }).textContent).not.toContain("selected");
  });

  it("puts a refused post's problem first in line for focus, without JavaScript", () => {
    const page = html({ error: WELCOME.required });
    const problem = page.querySelector(`#${CHOICES_ERROR_ID}`)!;
    expect(problem.textContent).toBe(WELCOME.required);
    expect(problem.hasAttribute("autofocus")).toBe(true);
    expect(page.querySelector("fieldset")?.getAttribute("aria-describedby")).toBe(CHOICES_ERROR_ID);
    expect(html().querySelector(`#${CHOICES_ERROR_ID}`)?.hasAttribute("autofocus")).toBe(false);
  });
});

describe("WelcomeChoices, hydrated", () => {
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

  async function mount(overrides: Partial<Props> = {}) {
    await act(async () => root.render(<WelcomeChoices {...props(overrides)} />));
    return container.querySelector("form")!;
  }

  /** Presses a submit button the way a browser does, and says whether the post went ahead. */
  function press(form: HTMLFormElement, value: "continue" | "explore") {
    const button = form.querySelector<HTMLButtonElement>(`button[value=${value}]`)!;
    const event = new Event("submit", { bubbles: true, cancelable: true }) as SubmitEvent;
    Object.defineProperty(event, "submitter", { value: button });
    act(() => {
      form.dispatchEvent(event);
    });
    return !event.defaultPrevented;
  }

  const count = () => container.querySelector(".welcome-actions__count")?.textContent;

  it("counts the cards chosen as they change", async () => {
    await mount({ selected: ["MEMBER"] });
    expect(count()).toBe("1 selected");
    act(() => container.querySelector<HTMLInputElement>("input[value=MENTOR]")!.click());
    expect(count()).toBe("2 selected");
    act(() => container.querySelector<HTMLInputElement>("input[value=MEMBER]")!.click());
    expect(count()).toBe("1 selected");
  });

  it("asks for a choice instead of posting nothing, and clears the ask once one is made", async () => {
    const form = await mount();
    expect(press(form, "continue")).toBe(false);
    const problem = container.querySelector(`#${CHOICES_ERROR_ID}`)!;
    expect(problem.textContent).toBe(WELCOME.required);
    expect(problem.getAttribute("role")).toBe("alert");
    act(() => container.querySelector<HTMLInputElement>("input[value=MEMBER]")!.click());
    expect(problem.textContent).toBe("");
  });

  it("lets just looking around through with nothing chosen", async () => {
    expect(press(await mount(), "explore")).toBe(true);
  });

  it("holds both buttons once the form is on its way, so a second press sends nothing", async () => {
    const form = await mount({ selected: ["MEMBER"] });
    expect(press(form, "continue")).toBe(true);
    expect(form.querySelector("button[value=continue]")?.getAttribute("aria-disabled")).toBe("true");
    expect(press(form, "explore")).toBe(false);
  });

  it("can be pressed again after the browser brings the page back from its history", async () => {
    const form = await mount({ selected: ["MEMBER"] });
    press(form, "continue");
    act(() => {
      window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted: true }));
    });
    expect(form.querySelector("button[value=continue]")?.hasAttribute("aria-disabled")).toBe(false);
    expect(press(form, "continue")).toBe(true);
  });
});
