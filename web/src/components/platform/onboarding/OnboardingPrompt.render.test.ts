import { readFileSync } from "node:fs";
import { join } from "node:path";
import { experimental_AstroContainer as AstroContainer } from "astro/container";
import { loadRenderers } from "astro:container";
import { getContainerRenderer } from "@astrojs/react/container-renderer";
import { Window } from "happy-dom";
import { beforeAll, describe, expect, it } from "vitest";
import { buttonClass } from "@/components/platform/ui";
import MentoringOverview from "@/components/platform/spaces/MentoringOverview.astro";
import { PROMPT } from "./copy";
import type { OnboardingView } from "./framing";
import OnboardingNotices from "./OnboardingNotices.astro";
import OnboardingPrompt from "./OnboardingPrompt.astro";

/*
 * Style-guide rollout S2: the one-time card ("How do you take part now?") is a
 * side note. It follows the page's title and primary action, and none of its
 * buttons is peach, so a space home keeps exactly one primary.
 */

let container: AstroContainer;

beforeAll(async () => {
  container = await AstroContainer.create({ renderers: await loadRenderers([getContainerRenderer()]) });
});

const VIEW: OnboardingView = {
  framing: "member",
  cards: [],
  prompt: { selected: ["MEMBER"], statuses: { MENTOR: "active" } },
  spaces: [],
  pending: [],
} as unknown as OnboardingView;

/** Parsed with happy-dom: the render config runs in node, where Astro compiles. */
const dom = (html: string) => {
  const { document } = new Window();
  document.body.innerHTML = html;
  return document.body;
};

describe("OnboardingPrompt", () => {
  it("renders the card with quiet buttons and a ghost way out, never a peach one", async () => {
    const html = await container.renderToString(OnboardingPrompt, { props: { view: VIEW, space: "cohort", class: "mt-6" } });
    const root = dom(html);
    expect(root.querySelector("[data-onboarding-prompt-slot]")?.className).toBe("mt-6");
    const buttons = [...root.querySelectorAll("[data-onboarding-prompt] button")];
    expect(buttons.map((button) => button.textContent?.trim())).toEqual([PROMPT.save, PROMPT.choose, PROMPT.notNow]);
    for (const button of buttons) expect(button.classList).not.toContain("bg-primary");
    expect(buttons[0]!.className).toContain(buttonClass({ variant: "quiet", size: "lg" }));
    expect(buttons[1]!.className).toContain(buttonClass({ variant: "quiet", size: "lg" }));
    expect(buttons[2]!.className).toBe(buttonClass({ variant: "ghost", size: "lg" }));
    // It returns to the home it sits on.
    expect(root.querySelector('input[name="return"]')?.getAttribute("value")).toBe("/dashboard/cohort");
  });

  it("renders nothing once the card has gone, or while onboarding is off", async () => {
    expect((await container.renderToString(OnboardingPrompt, { props: { view: { ...VIEW, prompt: null }, space: "cohort" } })).trim()).toBe("");
    expect((await container.renderToString(OnboardingPrompt, { props: { view: null, space: "cohort" } })).trim()).toBe("");
  });

  it("is no longer one of the notices at the top of the page", async () => {
    const html = await container.renderToString(OnboardingNotices, { props: { view: VIEW, space: "cohort" } });
    expect(html).not.toContain("data-onboarding-prompt");
    expect(html).not.toContain(PROMPT.title);
  });

  it("follows Mentoring's title and its primary, Review shared work", async () => {
    const card = await container.renderToString(OnboardingPrompt, { props: { view: VIEW, space: "mentoring", class: "mt-6" } });
    const html = await container.renderToString(MentoringOverview, { props: { awaiting: 2 }, slots: { "after-primary": card } });
    const order = ["<h1", "Review shared work", "data-onboarding-prompt", "Requests"].map((needle) => html.indexOf(needle));
    expect(order.every((at) => at >= 0)).toBe(true);
    expect(order.toSorted((a, b) => a - b)).toEqual(order);
  });
});

describe("the four space homes", () => {
  const page = (name: string) => readFileSync(join(process.cwd(), "src/pages/dashboard", `${name}.astro`), "utf8");

  it.each([
    ["index", "<ButtonLink variant=\"primary\""],
    ["mentorship", "<MentoringOverview"],
    ["community", "<PageHeader"],
    ["discover", "<PageHeader"],
  ])("%s places the card after the part that holds its title and primary", (name, before) => {
    const source = page(name);
    expect(source.indexOf(before), `${name} has ${before}`).toBeGreaterThan(-1);
    expect(source.indexOf("<OnboardingPrompt")).toBeGreaterThan(source.indexOf(before));
    expect(source).not.toMatch(/ExistingAccountCard/);
  });
});

describe("the card's stylesheet", () => {
  const css = readFileSync(join(process.cwd(), "src/components/platform/onboarding/framing.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

  it("starts compact at every width when a script can open it, not only on phones", () => {
    expect(css).toMatch(/@media \(scripting: enabled\) \{\s*\.onboarding-prompt:not\(\[data-expanded\]\)/);
  });

  it("draws from theme tokens: no raw colour, and no peach frame round the card", () => {
    expect(css.match(/rgba?\([^)]*\)|#[0-9a-f]{3,8}\b/gi) ?? []).toEqual([]);
    expect(css).toMatch(/\.onboarding-prompt \{[^}]*border: 1px solid var\(--color-hairline\)/);
  });
});
