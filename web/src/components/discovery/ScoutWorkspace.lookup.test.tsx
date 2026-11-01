// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ScoutWorkspace from "./ScoutWorkspace";

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

describe("looking up someone you know (QA1R-04)", () => {
  it("says only saved community profiles can be found, and promises no way round it", async () => {
    await act(async () => root.render(<ScoutWorkspace profiles={[]} />));
    const lookup = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Find someone you know")!;
    await act(async () => lookup.click());

    const hint = container.querySelector(".discovery-field small")?.textContent?.replace(/\s+/g, " ").trim();
    expect(hint).toBe(
      "Finds members who have saved a community profile, by name, without your scouting skills or opportunity criteria. Nobody else appears here.",
    );
    // A by-id read of anyone else is "not found" since F-4, so no link can be offered as a workaround.
    expect(hint).not.toMatch(/direct|link|may not appear/i);
  });
});
