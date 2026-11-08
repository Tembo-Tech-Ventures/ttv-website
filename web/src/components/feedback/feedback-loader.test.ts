// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { openFeedbackWidget, takeFeedbackRequest } from "./feedback-client";
import { installFeedbackLoader, type OpenFeedback } from "./feedback-loader";

/** A stand-in for the dialog module: counts loads and records each open with its trigger. */
function fakeDialog() {
  const opened: (HTMLElement | null)[] = [];
  const open: OpenFeedback = (trigger) => opened.push(trigger);
  const load = vi.fn(async () => ({ mountFeedbackDialog: vi.fn(async () => open) }));
  return { load, opened };
}

const settle = () => new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
let uninstall: (() => void) | undefined;

afterEach(() => {
  uninstall?.();
  uninstall = undefined;
  takeFeedbackRequest();
  document.body.innerHTML = "";
});

describe("the feedback loader", () => {
  it("loads nothing until someone asks for the form", async () => {
    const { load } = fakeDialog();
    uninstall = installFeedbackLoader(load);
    document.body.click();
    await settle();
    expect(load).not.toHaveBeenCalled();
  });

  it("loads and opens the form on a press of a server-rendered button, handing it that button", async () => {
    const { load, opened } = fakeDialog();
    uninstall = installFeedbackLoader(load);
    document.body.innerHTML = '<button type="button" data-open-feedback><span>Feedback</span></button>';
    const button = document.querySelector("button")!;
    button.querySelector("span")!.click();
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    expect(opened).toEqual([button]);
  });

  it("answers a menu's openFeedbackWidget(), and leaves no request behind", async () => {
    const { load, opened } = fakeDialog();
    uninstall = installFeedbackLoader(load);
    openFeedbackWidget();
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    expect(opened).toHaveLength(1);
    expect(takeFeedbackRequest()).toBe(false);
  });

  it("takes a request made before it was installed", async () => {
    const { load, opened } = fakeDialog();
    openFeedbackWidget();
    uninstall = installFeedbackLoader(load);
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    expect(opened).toHaveLength(1);
  });

  it("mounts the form once however many requests come while it loads", async () => {
    const { load, opened } = fakeDialog();
    uninstall = installFeedbackLoader(load);
    openFeedbackWidget();
    openFeedbackWidget();
    openFeedbackWidget();
    await settle();
    openFeedbackWidget();
    await settle();
    expect(load).toHaveBeenCalledTimes(1);
    expect(opened).toHaveLength(4);
  });

  it("tries again on the next press after a failed load", async () => {
    const { opened } = fakeDialog();
    const open: OpenFeedback = (trigger) => opened.push(trigger);
    const load = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue({ mountFeedbackDialog: async () => open });
    uninstall = installFeedbackLoader(load);
    openFeedbackWidget();
    await settle();
    expect(opened).toHaveLength(0);
    openFeedbackWidget();
    await settle();
    expect(load).toHaveBeenCalledTimes(2);
    expect(opened).toHaveLength(1);
  });
});
