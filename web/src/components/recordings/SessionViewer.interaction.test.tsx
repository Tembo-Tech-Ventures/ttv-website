// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SessionViewer, { RETRY_TIMEOUT_MS } from "./SessionViewer";

const SEGMENTS = [
  { id: "t1", startTime: 0, endTime: 4, text: "Welcome back.", speaker: "Mentor" },
  { id: "t2", startTime: 4, endTime: 75, text: "Today is about joins.", speaker: null },
  { id: "t3", startTime: 75, endTime: 90, text: "Questions?", speaker: null },
];

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  // happy-dom has no media pipeline: the video neither loads nor plays.
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => undefined);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function mount() {
  await act(async () => root.render(<SessionViewer videoUrl="/api/recordings/r1/video" title="Week 4: SQL joins" segments={SEGMENTS} />));
  return container.querySelector("video")!;
}

const lines = () => Array.from(container.querySelectorAll<HTMLButtonElement>("[data-transcript-panel] button"));

describe("session viewer", () => {
  it("names the video by the session's title", async () => {
    const video = await mount();
    const title = document.getElementById(video.getAttribute("aria-labelledby")!);
    expect(title?.textContent).toBe("Week 4: SQL joins");
  });

  it("gives each transcript line one stop, named for where it plays from", async () => {
    await mount();
    expect(lines()).toHaveLength(3);
    expect(container.querySelectorAll("[data-transcript-panel] button button")).toHaveLength(0);
    expect(lines().map((line) => line.textContent)).toEqual([
      "Play from 0:00MentorWelcome back.",
      "Play from 0:04Today is about joins.",
      "Play from 1:15Questions?",
    ]);
    expect(lines()[0]!.querySelector(".sr-only")?.textContent).toBe("Play from ");
  });

  it("seeks to a line's moment when it is chosen", async () => {
    const video = await mount();
    await act(async () => lines()[2]!.click());
    expect(video.currentTime).toBe(75);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  });

  it("says when the recording cannot play, keeps the transcript, and can try again", async () => {
    const video = await mount();
    const status = container.querySelector("output")!;
    expect(status.textContent).toBe("");
    expect(container.querySelector("[data-video-unavailable]")).toBeNull();

    await act(async () => video.dispatchEvent(new Event("error")));
    expect(status.textContent).toContain("This recording can’t be played right now");
    expect(container.querySelector("[data-video-unavailable]")).not.toBeNull();
    expect(video.classList).toContain("invisible");
    expect(lines()).toHaveLength(3);

    const retry = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Try again")!;
    retry.focus();
    await act(async () => retry.click());
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalled();
    // Still there while it retries, so keyboard focus is not dropped on the page.
    expect(retry.isConnected).toBe(true);
    expect(document.activeElement).toBe(retry);
    expect(retry.textContent).toBe("Trying again…");
    expect(retry.getAttribute("aria-disabled")).toBe("true");

    // Failing again: the same button, still focused, offers another try.
    await act(async () => video.dispatchEvent(new Event("error")));
    expect(document.activeElement).toBe(retry);
    expect(retry.textContent).toBe("Try again");

    // Loading this time: the message goes, and focus moves to the player it brought back.
    await act(async () => retry.click());
    await act(async () => video.dispatchEvent(new Event("loadeddata")));
    expect(status.textContent).toBe("");
    expect(video.classList).not.toContain("invisible");
    expect(container.querySelector("[data-video-unavailable]")).toBeNull();
    expect(document.activeElement).toBe(video);
  });

  it("gives up on a retry that hangs, so Try again comes back instead of sticking", async () => {
    const video = await mount();
    await act(async () => video.dispatchEvent(new Event("error")));
    vi.useFakeTimers();
    try {
      const retry = () => Array.from(container.querySelectorAll("button")).find((button) => /Try again|Trying again/.test(button.textContent ?? ""))!;
      await act(async () => retry().click());
      expect(retry().textContent).toBe("Trying again…");
      // The media request neither fails nor loads: a stalled connection.
      await act(async () => vi.advanceTimersByTime(RETRY_TIMEOUT_MS - 1));
      expect(retry().textContent).toBe("Trying again…");
      await act(async () => vi.advanceTimersByTime(1));
      expect(retry().textContent).toBe("Try again");
      expect(retry().hasAttribute("aria-disabled")).toBe(false);
      // And it can be tried again from there.
      await act(async () => retry().click());
      expect(retry().textContent).toBe("Trying again…");
    } finally {
      vi.useRealTimers();
    }
  });

  it("counts the video's metadata arriving as recovered", async () => {
    const video = await mount();
    await act(async () => video.dispatchEvent(new Event("error")));
    const retry = Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Try again")!;
    await act(async () => retry.click());
    await act(async () => video.dispatchEvent(new Event("loadedmetadata")));
    expect(container.querySelector("[data-video-unavailable]")).toBeNull();
    expect(video.classList).not.toContain("invisible");
  });
});
