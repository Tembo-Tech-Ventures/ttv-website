// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { askTemboHref } from "@/components/platform/search/ask-handoff";
import Composer from "./Composer";

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
  history.replaceState(null, "", "/");
  vi.unstubAllGlobals();
});

describe("Composer and a question handed over from search", () => {
  it("puts it in the box, focused, without sending it, and clears it from the address", async () => {
    history.replaceState(null, "", askTemboHref("retry webhook"));
    const onSend = vi.fn();
    await act(async () => root.render(<Composer onSend={onSend} disabled={false} />));
    const box = container.querySelector("textarea")!;
    expect(box.value).toBe("retry webhook");
    expect(document.activeElement).toBe(box);
    expect(onSend).not.toHaveBeenCalled();
    expect(location.hash).toBe("");
  });

  it("starts empty without one", async () => {
    history.replaceState(null, "", "/dashboard/ask#elsewhere");
    await act(async () => root.render(<Composer onSend={vi.fn()} disabled={false} />));
    expect(container.querySelector("textarea")!.value).toBe("");
    expect(location.hash).toBe("#elsewhere");
  });
});
