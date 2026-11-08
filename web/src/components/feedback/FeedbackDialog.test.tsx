// @vitest-environment happy-dom
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FEEDBACK_KIND_LABELS } from "@/lib/feedback/model";
import { buttonClass } from "@/components/platform/ui";
import { CONTROL } from "@/components/platform/ui/recipes";
import FeedbackDialog, { FEEDBACK_KIND_OPTIONS, MESSAGE_ID } from "./FeedbackDialog";
import FeedbackLauncher from "./FeedbackLauncher";
import type { OpenFeedback } from "./feedback-loader";
import { strokeWidthFor } from "./MarkupEditor";

let root: Root;
let container: HTMLDivElement;
let open: OpenFeedback;

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<FeedbackDialog onReady={(opener) => (open = opener)} />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const dialog = () => container.querySelector("dialog")!;
const message = () => document.getElementById(MESSAGE_ID) as HTMLTextAreaElement;
const button = (name: string) =>
  [...container.querySelectorAll("button")].find((element) => (element.getAttribute("aria-label") ?? element.textContent?.trim()) === name)!;

const settle = () =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });

async function type(text: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
    setter.call(message(), text);
    message().dispatchEvent(new Event("input", { bubbles: true }));
  });
}

describe("FeedbackDialog", () => {
  it("is a closed, labelled native dialog until it is asked for, then opens on the note", async () => {
    expect(dialog().open).toBe(false);
    expect(dialog().getAttribute("aria-labelledby")).toBe("feedback-title");
    const trigger = document.createElement("button");
    document.body.appendChild(trigger);
    await act(async () => open(trigger));
    expect(dialog().open).toBe(true);
    expect(document.activeElement).toBe(message());
    trigger.remove();
  });

  it("asks for the note with a visible label on the kit's field, focus ring included", () => {
    const label = container.querySelector(`label[for="${MESSAGE_ID}"]`);
    expect(label?.textContent).toBe("Your feedback");
    expect(label?.className).not.toContain("sr-only");
    for (const name of CONTROL.split(" ")) expect(message().classList).toContain(name);
    expect(message().className).not.toMatch(/outline-none/);
  });

  it("draws only from the kit and the theme: no older tokens or off-palette reds", () => {
    const html = container.innerHTML;
    expect(html).not.toMatch(/bg-bg-raised|border-rule|text-red-|bg-black|shadow-black|text-\[10px\]/);
    expect(button("Close feedback").getAttribute("data-variant")).toBe("ghost");
    expect(button("Send feedback").getAttribute("data-variant")).toBe("primary");
    // One peach action: the submit.
    expect(container.querySelectorAll('[data-variant="primary"]')).toHaveLength(1);
  });

  it("offers the kinds as pill toggles that a second press clears", async () => {
    const idea = button("Idea");
    expect(idea.getAttribute("aria-pressed")).toBe("false");
    await act(async () => idea.click());
    expect(idea.getAttribute("aria-pressed")).toBe("true");
    expect(message().placeholder).toBe("What would make this better for you?");
    await act(async () => idea.click());
    expect(idea.getAttribute("aria-pressed")).toBe("false");
  });

  it("says under the field what an empty note needs, and sends nothing", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    await act(async () => button("Send feedback").click());
    expect(message().getAttribute("aria-invalid")).toBe("true");
    expect(container.textContent).toContain("Tell us a little about it, or add a screenshot.");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("keeps the note and says what went wrong in a danger notice when sending fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ error: "Please try again tomorrow." }), { status: 429 })));
    await type("A fictional note.");
    await act(async () => button("Send feedback").click());
    await act(settle);
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.getAttribute("data-notice")).toBe("danger");
    expect(alert?.textContent).toContain("Please try again tomorrow.");
    expect(message().value).toBe("A fictional note.");
  });

  it("thanks the student and leads to their feedback page after a send", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "f1" }), { status: 201 })));
    await type("A fictional note.");
    await act(async () => button("Send feedback").click());
    await act(settle);
    expect(container.textContent).toContain("Thank you, it's with the team.");
    const link = container.querySelector<HTMLAnchorElement>('a[href="/dashboard/feedback"]');
    expect(link?.className).toBe(buttonClass({ variant: "primary" }));
  });

  it("offers the same kind labels the admin console shows", () => {
    for (const option of FEEDBACK_KIND_OPTIONS) expect(option.label).toBe(FEEDBACK_KIND_LABELS[option.value]);
  });
});

describe("FeedbackLauncher", () => {
  it("is a 44px kit button the loader answers, kept out of page captures and print", () => {
    const html = renderToStaticMarkup(<FeedbackLauncher />);
    expect(html).toContain("data-open-feedback");
    expect(html).toContain('aria-haspopup="dialog"');
    expect(html).toContain("data-feedback-ignore");
    expect(html).toContain("print:hidden");
    expect(html).toContain(`class="${buttonClass({ variant: "quiet", size: "lg" })}"`);
    expect(html).toContain("Feedback");
    // Usable before any script: never disabled while waiting for hydration.
    expect(html).not.toContain("disabled");
  });
});

describe("where the form comes from", () => {
  const SRC = join(process.cwd(), "src");
  const read = (path: string) => readFileSync(join(SRC, path), "utf8");

  it("hydrates no island on page load: every layout mounts the server-rendered loader", () => {
    for (const layout of ["layouts/BaseLayout.astro", "layouts/SpacesLayout.astro", "layouts/ImmersiveLayout.astro", "components/platform/onboarding/OnboardingFrame.astro"]) {
      const source = read(layout);
      expect(`${layout}: ${source.includes('from "@/components/feedback/Feedback.astro"')}`).toBe(`${layout}: true`);
      expect(source.match(/Feedback\w*\s+client:/) ?? []).toEqual([]);
    }
  });

  it("uses no Headless UI", () => {
    for (const file of readdirSync(join(SRC, "components/feedback"))) {
      if (/\.(tsx?|astro)$/.test(file) && !file.endsWith(".test.tsx")) expect(`${file}: ${read(`components/feedback/${file}`).includes("@headlessui")}`).toBe(`${file}: false`);
    }
  });
});

describe("strokeWidthFor", () => {
  it("scales with the image but never gets hairline-thin", () => {
    expect(strokeWidthFor(300)).toBe(3);
    expect(strokeWidthFor(2560)).toBe(9);
  });
});
