// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLiveAnnouncer, groupSentence, type LiveAnnouncerVoice } from "./announcer";
import LiveAnnouncer, { useAnnouncer } from "./LiveAnnouncer";

/** Everything the announcer says, in order, as a screen reader would hear it. */
function listen(voice: LiveAnnouncerVoice) {
  const heard: string[] = [];
  voice.store.subscribe(() => {
    const said = voice.store.getState();
    if (said) heard.push(`${said.priority}: ${said.message}`);
  });
  return heard;
}

const join = (names: readonly string[]) => groupSentence(names, "joined");

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("groupSentence", () => {
  it("says one person, two people, and a crowd", () => {
    expect(groupSentence(["Kevin Omondi"], "joined")).toBe("Kevin Omondi joined");
    expect(groupSentence(["Kevin Omondi", "Faith Njeri"], "joined")).toBe("Kevin Omondi and Faith Njeri joined");
    expect(groupSentence(["Kevin Omondi", "Faith Njeri", "Brian Kiprop"], "joined")).toBe("Kevin Omondi and 2 others joined");
    expect(groupSentence(["Kevin Omondi", "Faith Njeri", "Brian Kiprop", "Achieng Otieno"], "left")).toBe("Kevin Omondi and 3 others left");
    expect(groupSentence([], "joined")).toBe("");
  });
});

describe("createLiveAnnouncer", () => {
  it("speaks politely by default, and assertively when asked", () => {
    const voice = createLiveAnnouncer();
    const heard = listen(voice);
    voice.say("Kevin Omondi joined");
    vi.advanceTimersByTime(1_000);
    voice.say("Recording started", { priority: "assertive" });
    expect(heard).toEqual(["polite: Kevin Omondi joined", "assertive: Recording started"]);
    voice.dispose();
  });

  it("never repeats the same words in a burst", () => {
    const voice = createLiveAnnouncer();
    const heard = listen(voice);
    expect(voice.say("Connection lost", { priority: "assertive" })).toBe(true);
    expect(voice.say("Connection lost", { priority: "assertive" })).toBe(false);
    vi.advanceTimersByTime(3_000);
    expect(voice.say("Connection lost", { priority: "assertive" })).toBe(false);
    expect(heard).toEqual(["assertive: Connection lost"]);
    // Once the burst is over, the same thing happening again is news again.
    vi.advanceTimersByTime(3_000);
    expect(voice.say("Connection lost", { priority: "assertive" })).toBe(true);
    expect(heard).toEqual(["assertive: Connection lost", "assertive: Connection lost"]);
    voice.dispose();
  });

  it("spaces messages out, and lets an urgent one go ahead of waiting polite ones", () => {
    const voice = createLiveAnnouncer();
    const heard = listen(voice);
    voice.say("Kevin Omondi joined");
    voice.say("New message from Faith Njeri");
    voice.say("You were muted by a host", { priority: "assertive" });
    expect(heard).toEqual(["polite: Kevin Omondi joined"]);
    vi.advanceTimersByTime(1_000);
    expect(heard.at(-1)).toBe("assertive: You were muted by a host");
    vi.advanceTimersByTime(1_000);
    expect(heard.at(-1)).toBe("polite: New message from Faith Njeri");
    voice.dispose();
  });

  it("gathers a burst of arrivals into one sentence", () => {
    const voice = createLiveAnnouncer();
    const heard = listen(voice);
    voice.gather("joined", "Kevin Omondi", { sentence: join });
    vi.advanceTimersByTime(500);
    voice.gather("joined", "Faith Njeri", { sentence: join });
    voice.gather("joined", "Kevin Omondi", { sentence: join });
    voice.gather("joined", "Brian Kiprop", { sentence: join });
    expect(heard).toEqual([]);
    vi.advanceTimersByTime(1_500);
    expect(heard).toEqual(["polite: Kevin Omondi and 2 others joined"]);
    // The next arrival starts a new burst.
    voice.gather("joined", "Achieng Otieno", { sentence: join });
    vi.advanceTimersByTime(2_000);
    expect(heard).toEqual(["polite: Kevin Omondi and 2 others joined", "polite: Achieng Otieno joined"]);
    voice.dispose();
  });

  it("keeps bursts of different kinds apart", () => {
    const voice = createLiveAnnouncer({ gatherMs: 1_000 });
    const heard = listen(voice);
    voice.gather("joined", "Kevin Omondi", { sentence: join });
    voice.gather("left", "Faith Njeri", { sentence: (names) => groupSentence(names, "left") });
    vi.advanceTimersByTime(2_000);
    expect(heard).toEqual(["polite: Kevin Omondi joined", "polite: Faith Njeri left"]);
    voice.dispose();
  });

  it("says nothing empty, and nothing after it is disposed", () => {
    const voice = createLiveAnnouncer();
    const heard = listen(voice);
    expect(voice.say("   ")).toBe(false);
    voice.gather("joined", "Kevin Omondi", { sentence: join });
    voice.dispose();
    vi.advanceTimersByTime(5_000);
    expect(voice.say("Recording started")).toBe(false);
    expect(heard).toEqual([]);
  });

  it("refuses a pace it can't keep", () => {
    expect(() => createLiveAnnouncer({ gatherMs: -1 })).toThrow(RangeError);
  });
});

describe("LiveAnnouncer", () => {
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

  it("draws empty polite and assertive regions on the server, before anything is said", () => {
    const html = renderToStaticMarkup(<LiveAnnouncer name="call" />);
    expect(html).toBe(
      '<div class="sr-only" data-live-announcer="call"><output aria-live="polite" aria-atomic="true"></output><div role="alert" aria-live="assertive" aria-atomic="true"></div></div>',
    );
  });

  it("hands its announcer to the parts inside, and speaks each message into its region as a fresh node", async () => {
    let voice: LiveAnnouncerVoice | null = null;
    function Inside() {
      voice = useAnnouncer();
      return null;
    }
    await act(async () =>
      root.render(
        <LiveAnnouncer name="call">
          <Inside />
        </LiveAnnouncer>,
      ),
    );
    const polite = container.querySelector("output")!;
    const assertive = container.querySelector("[role=alert]")!;

    await act(async () => {
      voice!.say("Kevin Omondi joined");
    });
    expect(polite.textContent).toBe("Kevin Omondi joined");
    expect(assertive.textContent).toBe("");
    const first = polite.firstElementChild;

    await act(async () => {
      vi.advanceTimersByTime(1_000);
      voice!.say("Recording started", { priority: "assertive" });
    });
    expect(assertive.textContent).toBe("Recording started");
    expect(polite.textContent).toBe("");

    await act(async () => {
      vi.advanceTimersByTime(1_000);
      voice!.say("Faith Njeri joined");
    });
    expect(polite.firstElementChild).not.toBe(first);
  });

  it("uses an announcer it is given, and leaves it running when it unmounts", async () => {
    const voice = createLiveAnnouncer();
    await act(async () => root.render(<LiveAnnouncer voice={voice} />));
    await act(async () => root.render(<div />));
    expect(voice.say("Still here")).toBe(true);
    voice.dispose();
  });

  it("is null outside a LiveAnnouncer, so parts that speak stay quiet", () => {
    let found: unknown = "unset";
    function Probe() {
      found = useAnnouncer();
      return null;
    }
    renderToStaticMarkup(<Probe />);
    expect(found).toBeNull();
  });
});
