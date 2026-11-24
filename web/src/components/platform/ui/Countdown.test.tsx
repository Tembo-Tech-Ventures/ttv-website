// @vitest-environment happy-dom
import { act, StrictMode } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup, renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveAnnouncer, type LiveAnnouncerVoice } from "./announcer";
import Countdown from "./Countdown";
import { CALL_WARNINGS, CHECK_IN_WARNINGS, armWarnings, dueWarning, nextChange, timeLeft, urgency, warningMessage } from "./countdown";
import LiveAnnouncer from "./LiveAnnouncer";

const MINUTE = 60_000;
/** 26 Nov 2026, 15:47 UTC: 18:47 in Nairobi. */
const START = Date.UTC(2026, 10, 26, 15, 47);

describe("the time left, as shown and said", () => {
  it("counts whole minutes, rounded up, while more than one is left", () => {
    expect(timeLeft(90 * 60)).toEqual({ shown: "90 min left", spoken: "90 minutes left" });
    expect(timeLeft(12 * 60 + 1)).toEqual({ shown: "13 min left", spoken: "13 minutes left" });
    expect(timeLeft(12 * 60)).toEqual({ shown: "12 min left", spoken: "12 minutes left" });
    expect(timeLeft(61)).toEqual({ shown: "2 min left", spoken: "2 minutes left" });
  });

  it("counts seconds in the last minute, and tens of seconds under reduced motion", () => {
    expect(timeLeft(60)).toEqual({ shown: "1:00 left", spoken: "1 minute left" });
    expect(timeLeft(41.2)).toEqual({ shown: "0:42 left", spoken: "42 seconds left" });
    expect(timeLeft(0.4)).toEqual({ shown: "0:01 left", spoken: "1 second left" });
    expect(timeLeft(41.2, true)).toEqual({ shown: "0:50 left", spoken: "50 seconds left" });
    expect(timeLeft(9, true)).toEqual({ shown: "0:10 left", spoken: "10 seconds left" });
    expect(timeLeft(0)).toEqual({ shown: "Ending now", spoken: "Ending now" });
  });

  it("names how close the end is in words, not only colour", () => {
    expect([urgency(900), urgency(300), urgency(60), urgency(0)]).toEqual(["calm", "soon", "now", "over"]);
  });

  it("says each warning as what ends, and when", () => {
    expect(warningMessage(15 * 60, "The session")).toBe("The session ends in 15 minutes.");
    expect(warningMessage(60, "The call")).toBe("The call ends in 1 minute.");
    expect(warningMessage(10, "The check-in")).toBe("The check-in ends in 10 seconds.");
  });

  it("holds the real limits: a call warns at 75 of 90 minutes, a check-in at 20 of 30", () => {
    expect(CALL_WARNINGS.map((warning) => [warning.at, warning.priority])).toEqual([
      [900, "polite"],
      [300, "polite"],
      [60, "assertive"],
      [10, "assertive"],
    ]);
    expect(90 * 60 - CALL_WARNINGS[0]!.at).toBe(75 * 60);
    expect(CHECK_IN_WARNINGS.map((warning) => [warning.at, warning.priority])).toEqual([
      [600, "polite"],
      [300, "polite"],
      [60, "assertive"],
      [10, "assertive"],
    ]);
  });
});

describe("when it looks again", () => {
  it("wakes once a minute while minutes are shown, never every second", () => {
    expect(nextChange(12 * 60, [])).toBe(60_005);
    expect(nextChange(12 * 60 + 20, [])).toBe(20_005);
    expect(nextChange(61, [])).toBe(1_005);
  });

  it("wakes every second in the last minute, or every ten under reduced motion", () => {
    expect(nextChange(42, [])).toBe(1_005);
    expect(nextChange(42, [], true)).toBe(2_005);
  });

  it("wakes for a warning falling due between minutes", () => {
    expect(nextChange(15 * 60 + 30, CALL_WARNINGS)).toBe(30_005);
    expect(nextChange(15, CALL_WARNINGS, true)).toBe(5_005);
  });

  it("arms warnings when it starts or its end moves: spent once past by more than the grace, armed again once ahead", () => {
    expect([...armWarnings(4 * 60, CALL_WARNINGS, new Set())].toSorted((a, b) => a - b)).toEqual([300, 900]);
    // Stepped over by less than 2 seconds: still to be said.
    expect([...armWarnings(299, CALL_WARNINGS, new Set([900]))]).toEqual([900]);
    // Said already: stays said.
    expect([...armWarnings(299, CALL_WARNINGS, new Set([900, 300]))].toSorted((a, b) => a - b)).toEqual([300, 900]);
    // The end moved later: what it moved back before is armed again.
    expect([...armWarnings(10 * 60, CALL_WARNINGS, new Set([900, 300]))]).toEqual([900]);
  });

  it("says only the latest of several warnings crossed while asleep, and spends them all", () => {
    expect(dueWarning(30, CALL_WARNINGS, new Set([900]))).toEqual({ say: CALL_WARNINGS[2], spend: [300, 60] });
    expect(dueWarning(30, CALL_WARNINGS, new Set([900, 300, 60]))).toEqual({ say: null, spend: [] });
    expect(dueWarning(-1, CALL_WARNINGS, new Set([900, 300, 60]))).toEqual({ say: null, spend: [10] });
  });
});

describe("Countdown", () => {
  let root: Root;
  let container: HTMLDivElement;
  let voice: LiveAnnouncerVoice;
  let heard: string[];
  let reduceMotion: boolean;
  const motionListeners = new Set<() => void>();

  const timer = () => container.querySelector("[role=timer]")!;
  const shown = () => timer().querySelector("[aria-hidden]")!.textContent;
  const countdown = () => container.querySelector<HTMLElement>("[data-countdown]")!;

  async function advance(ms: number) {
    await act(async () => {
      vi.advanceTimersByTime(ms);
    });
  }

  async function mount(node: React.ReactNode) {
    await act(async () => root.render(<LiveAnnouncer voice={voice}>{node}</LiveAnnouncer>));
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    reduceMotion = false;
    motionListeners.clear();
    vi.stubGlobal("matchMedia", (query: string) => ({
      get matches() {
        return query.includes("reduce") && reduceMotion;
      },
      addEventListener: (_: string, listener: () => void) => motionListeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => motionListeners.delete(listener),
    }));
    voice = createLiveAnnouncer({ throttleMs: 0 });
    heard = [];
    voice.store.subscribe(() => {
      const said = voice.store.getState();
      if (said) heard.push(`${said.priority}: ${said.message}`);
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    voice.dispose();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows when it ends and the time left, in tabular numerals, as a timer", async () => {
    await mount(<Countdown endsAt={START + 12 * MINUTE + 30_000} />);
    // 18:59:30, rounded up to the minute as the minutes left are.
    expect(countdown().textContent).toContain("Ends at 19:00");
    expect(shown()).toBe("13 min left");
    expect(timer().querySelector(".sr-only")!.textContent).toBe("13 minutes left");
    expect(countdown().className).toContain("tabular-nums");
    // A timer is not a live region: the warnings do the talking.
    expect(timer().getAttribute("aria-live")).toBeNull();
  });

  it("changes once a minute until the last minute", async () => {
    await mount(<Countdown endsAt={START + 3 * MINUTE} showEndTime={false} />);
    expect(shown()).toBe("3 min left");
    await advance(59_000);
    expect(shown()).toBe("3 min left");
    await advance(1_100);
    expect(shown()).toBe("2 min left");
    await advance(MINUTE);
    expect(shown()).toBe("1:00 left");
    await advance(1_000);
    expect(shown()).toBe("0:59 left");
    await advance(1_000);
    expect(shown()).toBe("0:58 left");
  });

  it("says each of a call's warnings once, politely and then at once", async () => {
    await mount(<Countdown endsAt={START + 16 * MINUTE} warnings="call" subject="The session" />);
    expect(heard).toEqual([]);
    await advance(MINUTE + 100);
    expect(heard).toEqual(["polite: The session ends in 15 minutes."]);
    await advance(10 * MINUTE);
    expect(heard.at(-1)).toBe("polite: The session ends in 5 minutes.");
    await advance(4 * MINUTE);
    expect(heard.at(-1)).toBe("assertive: The session ends in 1 minute.");
    await advance(50_000);
    expect(heard.at(-1)).toBe("assertive: The session ends in 10 seconds.");
    await advance(20_000);
    expect(heard).toEqual([
      "polite: The session ends in 15 minutes.",
      "polite: The session ends in 5 minutes.",
      "assertive: The session ends in 1 minute.",
      "assertive: The session ends in 10 seconds.",
    ]);
  });

  it("says a check-in's warnings at 10 and 5 minutes", async () => {
    await mount(<Countdown endsAt={START + 11 * MINUTE} warnings="check-in" subject="The check-in" />);
    await advance(6 * MINUTE + 100);
    expect(heard).toEqual(["polite: The check-in ends in 10 minutes.", "polite: The check-in ends in 5 minutes."]);
  });

  it("never says a warning twice, even when it renders again", async () => {
    await mount(<Countdown endsAt={START + 5 * MINUTE + 2_000} warnings="call" />);
    await advance(2_100);
    expect(heard).toEqual(["polite: The call ends in 5 minutes."]);
    await mount(<Countdown endsAt={START + 5 * MINUTE + 2_000} warnings={[...CALL_WARNINGS]} subject="The call" />);
    await advance(30_000);
    expect(heard).toEqual(["polite: The call ends in 5 minutes."]);
  });

  it("says a warning once when the server corrects the end across it", async () => {
    await mount(<Countdown endsAt={START + 5 * MINUTE + 500} warnings="call" />);
    expect(heard).toEqual([]);
    // The server's clock says it ends 700 ms sooner: 4:59.8 left, just past the 5-minute warning.
    await mount(<Countdown endsAt={START + 5 * MINUTE - 200} warnings="call" />);
    expect(heard).toEqual(["polite: The call ends in 5 minutes."]);
    // Corrected again, back and forth across it: it is not said twice.
    await mount(<Countdown endsAt={START + 5 * MINUTE - 900} warnings="call" />);
    await advance(30_000);
    expect(heard).toEqual(["polite: The call ends in 5 minutes."]);
    // The same holds for the last warnings.
    await mount(<Countdown endsAt={Date.now() + 60_400} warnings="call" />);
    await mount(<Countdown endsAt={Date.now() + 59_700} warnings="call" />);
    expect(heard.at(-1)).toBe("assertive: The call ends in 1 minute.");
    await advance(50_000);
    await mount(<Countdown endsAt={Date.now() + 9_000} warnings="call" />);
    expect(heard.slice(1)).toEqual(["assertive: The call ends in 1 minute.", "assertive: The call ends in 10 seconds."]);
  });

  it("says a warning again when the end is put back past it", async () => {
    await mount(<Countdown endsAt={START + 5 * MINUTE + 1_000} warnings="call" />);
    await advance(1_100);
    expect(heard).toEqual(["polite: The call ends in 5 minutes."]);
    // A host extends the call by ten minutes.
    await mount(<Countdown endsAt={START + 15 * MINUTE + 1_000} warnings="call" />);
    expect(heard).toEqual(["polite: The call ends in 5 minutes."]);
    await advance(10 * MINUTE + 100);
    expect(heard).toEqual(["polite: The call ends in 5 minutes.", "polite: The call ends in 5 minutes."]);
  });

  it("says a warning it starts within 2 seconds of", async () => {
    await mount(<Countdown endsAt={START + 5 * MINUTE - 1_500} warnings="call" />);
    expect(heard).toEqual(["polite: The call ends in 5 minutes."]);
  });

  it("says nothing about warnings already past when it starts", async () => {
    await mount(<Countdown endsAt={START + 4 * MINUTE} warnings="call" />);
    await advance(30_000);
    expect(heard).toEqual([]);
    await advance(3 * MINUTE);
    expect(heard).toEqual(["assertive: The call ends in 1 minute."]);
  });

  it("after a sleeping tab wakes, says only the most urgent warning it missed", async () => {
    await mount(<Countdown endsAt={START + 6 * MINUTE} warnings="call" />);
    // The tab's timers stall; the clock does not.
    vi.setSystemTime(START + 5 * MINUTE + 30_000);
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    expect(heard).toEqual(["assertive: The call ends in 1 minute."]);
    await advance(10 * 1000);
    expect(heard).toEqual(["assertive: The call ends in 1 minute."]);
  });

  it("is quiet outside a LiveAnnouncer", async () => {
    await act(async () => root.render(<Countdown endsAt={START + 61_000} warnings="call" />));
    await advance(2_100);
    expect(shown()).toBe("0:59 left");
    expect(heard).toEqual([]);
  });

  it("says how close the end is in words and an icon as well as colour", async () => {
    await mount(<Countdown endsAt={START + 6 * MINUTE} />);
    expect(countdown().dataset.urgency).toBe("calm");
    const calmIcon = countdown().querySelector("svg")!.innerHTML;
    await advance(MINUTE + 100);
    expect(countdown().dataset.urgency).toBe("soon");
    expect(countdown().className).toContain("text-warning-ink");
    expect(countdown().querySelector("svg")!.innerHTML).not.toBe(calmIcon);
    expect(shown()).toBe("5 min left");
    await advance(4 * MINUTE);
    expect(countdown().dataset.urgency).toBe("now");
    expect(countdown().className).toContain("text-danger-ink");
  });

  it("calls onEnd once, when the time is up, and stops", async () => {
    const onEnd = vi.fn();
    await mount(<Countdown endsAt={START + 3_000} onEnd={onEnd} />);
    await advance(3_100);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(shown()).toBe("Ending now");
    expect(countdown().dataset.urgency).toBe("over");
    await advance(MINUTE);
    expect(onEnd).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  describe("under reduced motion", () => {
    it("moves through the last minute in steps of ten seconds, not every second", async () => {
      reduceMotion = true;
      await mount(<Countdown endsAt={START + 60_000} showEndTime={false} />);
      expect(shown()).toBe("1:00 left");
      await advance(1_000);
      expect(shown()).toBe("1:00 left");
      await advance(9_100);
      expect(shown()).toBe("0:50 left");
      await advance(5_000);
      expect(shown()).toBe("0:50 left");
      await advance(5_000);
      expect(shown()).toBe("0:40 left");
    });

    it("follows the setting when it changes, and changes colour as a cut", async () => {
      await mount(<Countdown endsAt={START + 45_000} showEndTime={false} />);
      expect(shown()).toBe("0:45 left");
      expect(countdown().className).toContain("motion-reduce:transition-none");
      reduceMotion = true;
      await act(async () => {
        for (const listener of motionListeners) listener();
      });
      expect(shown()).toBe("0:50 left");
    });

    it("still says every warning, once", async () => {
      reduceMotion = true;
      await mount(<Countdown endsAt={START + 61_000} warnings="call" />);
      await advance(61_000);
      expect(heard).toEqual(["assertive: The call ends in 1 minute.", "assertive: The call ends in 10 seconds."]);
    });
  });

  it("runs the same under StrictMode, saying each warning once", async () => {
    await act(async () =>
      root.render(
        <StrictMode>
          <LiveAnnouncer voice={voice}>
            <Countdown endsAt={START + 61_000} warnings="call" />
          </LiveAnnouncer>
        </StrictMode>,
      ),
    );
    await advance(61_000);
    expect(heard).toEqual(["assertive: The call ends in 1 minute.", "assertive: The call ends in 10 seconds."]);
  });

  it("draws the time left on the server only when told when the server drew it", () => {
    const told = renderToStaticMarkup(<Countdown endsAt={START + 15 * MINUTE} renderedAt={START} />);
    expect(told).toContain("Ends at 19:02");
    expect(told).toContain("15 min left");
    expect(told).toContain('role="timer"');
    // Without it, only what can't go stale: when it ends.
    const untold = renderToStaticMarkup(<Countdown endsAt={START + 15 * MINUTE} />);
    expect(untold).toContain("Ends at 19:02");
    expect(untold).not.toContain("min left");
    expect(untold).toContain('data-urgency="calm"');
  });

  it("hydrates without a mismatch, then shows the urgency the browser's clock finds", async () => {
    const node = <Countdown endsAt={START + 6 * MINUTE} />;
    const page = document.createElement("div");
    document.body.appendChild(page);
    page.innerHTML = renderToString(node);
    // The page reaches the browser two minutes after the server drew it: past the 5-minute mark.
    vi.setSystemTime(START + 2 * MINUTE);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    let hydrated!: Root;
    await act(async () => {
      hydrated = hydrateRoot(page, node);
    });
    expect(errors.mock.calls.map((call) => String(call[0]).slice(0, 300))).toEqual([]);
    errors.mockRestore();
    const drawn = page.querySelector<HTMLElement>("[data-countdown]")!;
    expect(drawn.dataset.urgency).toBe("soon");
    expect(drawn.className).toContain("text-warning-ink");
    expect(drawn.querySelector("[role=timer] [aria-hidden]")!.textContent).toBe("4 min left");
    await act(async () => hydrated.unmount());
    page.remove();
  });
});
