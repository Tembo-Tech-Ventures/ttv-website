// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Meeting } from "@/lib/platform/contracts";
import type { RoomAnswer } from "@/lib/meetings/room-api";
import {
  ScreenShareError, type MediaChoice, type RoomClient, type RoomListener, type RoomNotice, type RoomNoticeListener, type RoomParticipant, type RoomState,
} from "@/lib/meetings/room-client";
import { ROOM_POLL_MS, WAITING_POLL_MS, type CallRoomProps } from "@/lib/meetings/room-model";

/**
 * The call room island, every state (UX-REVIEW §3, §4, §5): the pre-join page (ready, waiting, too
 * early, unavailable, a refused or failed join), the room (announcements, the no-host countdown, the
 * panels, the toolbar, leaving, ending, removing) and the pages after it, with the cleanup of the
 * room client on every way out. The meeting routes and the provider client are stand-ins.
 */

const api = vi.hoisted(() => ({
  get: vi.fn(), join: vi.fn(), leave: vi.fn(), leaveOnExit: vi.fn(), remove: vi.fn(), end: vi.fn(),
}));
vi.mock("@/lib/meetings/room-api", () => ({ roomApi: api }));
const load = vi.hoisted(() => ({ client: null as RoomClient | null, fail: false }));
vi.mock("@/lib/meetings/room-client", async (original) => ({
  ...await original<typeof import("@/lib/meetings/room-client")>(),
  loadRoomClient: vi.fn(async () => {
    if (load.fail) throw new Error("No client");
    return load.client!;
  }),
}));

const { default: CallRoom } = await import("./CallRoom");

const NOW = Date.parse("2026-11-27T15:00:00Z");
const HOST = "faith";
const ME = "wanjiku";

/** A room client the test drives: its state, its notices, and whether it was released. */
class TestRoomClient implements RoomClient {
  readonly kind = "fake" as const;
  canShareScreen = true;
  state: RoomState = { connection: "connected", participants: [], recording: "recording" };
  listeners = new Set<RoomListener>();
  noticeListeners = new Set<RoomNoticeListener>();
  joinedWith: MediaChoice | null = null;
  join = vi.fn(async ({ media }: { media: MediaChoice }) => { this.joinedWith = media; });
  leave = vi.fn(async () => {});
  setMicrophone = vi.fn(async (on: boolean) => this.patchSelf({ microphoneOn: on }));
  setCamera = vi.fn(async (on: boolean) => this.patchSelf({ cameraOn: on }));
  startScreenShare = vi.fn(async () => this.patchSelf({ sharing: true }));
  stopScreenShare = vi.fn(async () => this.patchSelf({ sharing: false }));
  muteParticipant = vi.fn(async () => {});
  stopParticipantShare = vi.fn(async () => {});
  getState = () => this.state;
  subscribe(listener: RoomListener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  onNotice(listener: RoomNoticeListener) { this.noticeListeners.add(listener); return () => this.noticeListeners.delete(listener); }
  set(change: Partial<RoomState>) {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener(this.state);
  }
  notify(notice: RoomNotice) { for (const listener of this.noticeListeners) listener(notice); }
  patchSelf(change: Partial<RoomParticipant>) {
    this.set({ participants: this.state.participants.map((person) => (person.self ? { ...person, ...change } : person)) });
  }
}

const person = (userId: string, name: string, change: Partial<RoomParticipant> = {}): RoomParticipant => ({
  userId, name, self: false, microphoneOn: true, cameraOn: false, speaking: false, sharing: false, video: null, screen: null, ...change,
});

type MeetingChange = Partial<Omit<Meeting, "you">> & { you?: Partial<Meeting["you"]> };
function meeting(change: MeetingChange = {}): Meeting {
  const { you, ...rest } = change;
  return {
    id: "call-1", channelId: "c", purpose: "SESSION", title: "Session 10: Testing payment callbacks", scheduledStartAt: NOW + 5 * 60_000,
    bookedMinutes: 60, limitMinutes: 90, recordingPolicy: "ALWAYS", state: "SCHEDULED", openedAt: null, hardEndAt: null, endedAt: null,
    endReason: null, seatsHeld: 0, now: NOW, ...rest,
    you: { canJoin: false, canHost: false, seat: null, role: null, ...you },
  };
}
const live = (change: MeetingChange = {}) =>
  meeting({ state: "LIVE", openedAt: NOW - 60_000, hardEndAt: NOW + 89 * 60_000, seatsHeld: 1, ...change, you: { canJoin: true, ...change.you } });

function props(change: Partial<CallRoomProps> = {}): CallRoomProps {
  return {
    meeting: meeting(), self: { userId: ME, name: "Wanjiku Mwangi", image: null }, hostIds: [HOST, "amina"], cohortName: "Cohort 04",
    chat: { href: "/dashboard/cohort/c/cohort-04?thread=card", place: "#cohort-04" },
    back: { href: "/dashboard/cohort/sessions", label: "Back to Sessions" },
    recordingRefused: false, conductAgreed: true, conductHref: "/dashboard/community/conduct", unavailable: false, renderedAt: NOW,
    ...change,
  };
}

const ok = <T,>(value: T): RoomAnswer<T> => ({ ok: true, value });

/** A stream the page can draw: the browser's own type, holding the test's tracks. */
function stream(tracks: { kind: string; stop: () => void; enabled: boolean }[]): MediaStream {
  return Object.assign(new MediaStream(), {
    getTracks: () => tracks, getAudioTracks: () => tracks.filter(({ kind }) => kind === "audio"),
    getVideoTracks: () => tracks.filter(({ kind }) => kind === "video"),
  });
}

let root: Root;
let container: HTMLDivElement;
let client: TestRoomClient;
const opened: { stop: ReturnType<typeof vi.fn> }[] = [];

beforeEach(() => {
  vi.useFakeTimers({ now: NOW, toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"] });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  client = new TestRoomClient();
  load.client = client;
  load.fail = false;
  opened.length = 0;
  for (const fn of Object.values(api)) fn.mockReset();
  api.leave.mockResolvedValue(ok(live()));
  api.leaveOnExit.mockResolvedValue(new Response());
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async (constraints: MediaStreamConstraints) => {
        const track = { kind: constraints.video ? "video" : "audio", stop: vi.fn(), enabled: true };
        opened.push(track);
        return stream([track]);
      }),
      enumerateDevices: vi.fn(async () => []),
    },
  });
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

/** The page draws the island once; each render here is a fresh page. */
let renders = 0;
async function render(value: CallRoomProps) {
  await act(async () => root.render(<CallRoom key={++renders} {...value} />));
  await settle();
}
/** Lets promises and timers run, inside act. */
async function settle(ms = 0) {
  await act(async () => { await vi.advanceTimersByTimeAsync(ms); });
}

const $ = <T extends Element = HTMLElement>(selector: string) => container.querySelector<T>(selector) ?? document.querySelector<T>(selector);
const button = (name: string | RegExp) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((candidate) => {
  const label = candidate.getAttribute("aria-label") ?? candidate.textContent ?? "";
  return typeof name === "string" ? label.trim() === name : name.test(label);
});
const heading = () => $("h1")!;
const polite = () => $("[data-live-announcer=call] output")!.textContent;
const assertive = () => $("[data-live-announcer=call] [role=alert]")!.textContent;
async function press(target: Element | null | undefined) {
  if (!target) throw new Error("Nothing to press");
  await act(async () => { target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 })); });
  await settle();
}
async function key(target: Element, name: string) {
  await act(async () => { target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true })); });
  await settle();
}

/** Into the room as the host who starts it, with `others` in the call. */
async function startAsHost(others: RoomParticipant[] = []) {
  client.state = { ...client.state, participants: [person(HOST, "Faith Njeri", { self: true }), ...others] };
  api.join.mockResolvedValue(ok({ meeting: live({ you: { canHost: true, seat: "HELD", role: "HOST" } }), provider: "fake", token: "fake.t" }));
  await render(props({ self: { userId: HOST, name: "Faith Njeri", image: null }, meeting: meeting({ scheduledStartAt: NOW, you: { canHost: true, canJoin: true } }) }));
  await press($("[data-call-join]"));
  await settle(1_100);
}

/** Into the room as a member of a live call, with `others` in it. */
async function joinAsMember(others: RoomParticipant[] = [person(HOST, "Faith Njeri")], change: Omit<MeetingChange, "you"> = {}) {
  client.state = { ...client.state, participants: [person(ME, "Wanjiku Mwangi", { self: true, cameraOn: true }), ...others] };
  api.join.mockResolvedValue(ok({ meeting: live({ ...change, you: { seat: "HELD", role: "MEMBER" } }), provider: "fake", token: "fake.t" }));
  await render(props({ meeting: live(change) }));
  await press($("[data-call-join]"));
}

describe("before joining", () => {
  it("renders on the server with the title, what is recorded and Join, and no device check until the browser runs", () => {
    const html = renderToString(<CallRoom {...props({ meeting: live() })} />);
    expect(html).toContain("Session 10: Testing payment callbacks");
    expect(html).toContain("This session is being recorded, since 17:59 EAT");
    expect(html).toContain("Join session");
    expect(html).not.toContain("data-call-devices");
    expect(html).not.toContain("This browser can&#x27;t join calls");
  });

  it("lets a host start, with the recording notice before Start and one peach action", async () => {
    await render(props({ meeting: meeting({ scheduledStartAt: NOW, you: { canHost: true, canJoin: true } }) }));
    const start = $<HTMLButtonElement>("[data-call-join]")!;
    expect(start.textContent).toBe("Start session");
    expect(start.disabled).toBe(false);
    expect(container.textContent).toContain("This session is recorded");
    expect(container.querySelectorAll("[data-variant=primary]")).toHaveLength(1);
    // The device check opened the microphone (and camera) for the preview.
    expect($("[data-call-devices]")).not.toBeNull();
  });

  it("holds Start until ten minutes before the session, saying from when, then offers it", async () => {
    await render(props({ meeting: meeting({ scheduledStartAt: NOW + 15 * 60_000, you: { canHost: true, canJoin: true } }) }));
    const start = $<HTMLButtonElement>("[data-call-join]")!;
    expect(start.disabled).toBe(true);
    expect($("#call-join-reason")!.textContent).toBe("You can start this session from 18:05 EAT, 10 minutes before it begins.");
    expect(start.getAttribute("aria-describedby")).toBe("call-join-reason");
    await settle(5 * 60_000 + 100);
    expect($<HTMLButtonElement>("[data-call-join]")!.disabled).toBe(false);
  });

  it("has a member wait for a host, then says the session started and lets them join", async () => {
    api.get.mockResolvedValue(ok(meeting()));
    await render(props());
    expect($<HTMLButtonElement>("[data-call-join]")!.disabled).toBe(true);
    expect($("#call-join-reason")!.textContent).toBe("A host hasn't started the session yet");
    await settle(WAITING_POLL_MS);
    expect(api.get).toHaveBeenCalledOnce();
    api.get.mockResolvedValue(ok(live()));
    await settle(WAITING_POLL_MS);
    expect(polite()).toBe("The session has started. You can join now.");
    expect($<HTMLButtonElement>("[data-call-join]")!.disabled).toBe(false);
    expect($("[data-call-join]")!.textContent).toBe("Join session");
  });

  it("offers joining with the camera off, or audio only for low data, and joins with those choices", async () => {
    await joinAsMember([], {});
    expect(client.join).toHaveBeenCalledOnce();
    expect(client.joinedWith).toEqual({ microphoneId: null, cameraId: null, microphoneOn: true, cameraOn: true, audioOnly: false });
    act(() => root.unmount());
    root = createRoot(container);
    client = new TestRoomClient();
    load.client = client;
    await render(props({ meeting: live() }));
    await press($("input[name=audioOnly]"));
    expect($<HTMLInputElement>("input[name=cameraOff]")!.checked).toBe(true);
    expect($<HTMLInputElement>("input[name=cameraOff]")!.disabled).toBe(true);
    api.join.mockResolvedValue(ok({ meeting: live({ you: { seat: "HELD" } }), provider: "fake", token: "t" }));
    await press($("[data-call-join]"));
    expect(client.joinedWith).toMatchObject({ cameraOn: false, audioOnly: true });
    // In the room, low data keeps the camera off and says why.
    expect(button("Turn camera on")!.disabled).toBe(true);
  });

  it("releases the preview's camera and microphone on Join", async () => {
    await joinAsMember();
    expect(opened.length).toBeGreaterThan(0);
    for (const track of opened) expect(track.stop).toHaveBeenCalled();
  });

  it("says when a browser blocked the camera, and offers joining without it", async () => {
    const media = navigator.mediaDevices as unknown as { getUserMedia: ReturnType<typeof vi.fn> };
    media.getUserMedia.mockImplementation(async (constraints: MediaStreamConstraints) => {
      if (constraints.video) throw new DOMException("Blocked", "NotAllowedError");
      return stream([]);
    });
    await render(props({ meeting: live() }));
    expect(container.textContent).toContain("TTV can't use your camera");
    await press(button("Join without camera"));
    expect($<HTMLInputElement>("input[name=cameraOff]")!.checked).toBe(true);
    expect(container.textContent).not.toContain("TTV can't use your camera");
  });

  it("says when this browser can't make calls at all, with Join off", async () => {
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
    await render(props({ meeting: live() }));
    expect(container.textContent).toContain("This browser can't join calls");
    expect($<HTMLButtonElement>("[data-call-join]")!.disabled).toBe(true);
  });

  it("offers no Join where calls aren't available yet, or in an archived channel", async () => {
    await render(props({ meeting: live(), unavailable: true }));
    expect($("#call-join-reason")!.textContent).toBe("Calls aren't available here yet.");
    expect($<HTMLButtonElement>("[data-call-join]")!.disabled).toBe(true);
    await render(props({ meeting: live({ you: { canJoin: false } }) }));
    expect($("#call-join-reason")!.textContent).toBe("This call's channel is archived, so it can't be joined.");
  });

  it("asks for the code of conduct when the server does, keeping the page", async () => {
    api.join.mockResolvedValue({ ok: false, kind: "conduct" });
    await render(props({ meeting: live() }));
    await press($("[data-call-join]"));
    expect(container.textContent).toContain("Agree to how we talk to each other first");
    expect(container.querySelector<HTMLAnchorElement>('a[href="/dashboard/community/conduct"]')!.target).toBe("_blank");
    expect(assertive()).toBe("Agree to how we talk to each other before you join.");
  });

  it("says the call service didn't answer, and Join stays", async () => {
    api.join.mockResolvedValue({ ok: false, kind: "unavailable" });
    await render(props({ meeting: live() }));
    await press($("[data-call-join]"));
    expect(container.textContent).toContain("The call didn't start");
    expect($<HTMLButtonElement>("[data-call-join]")!.disabled).toBe(false);
    expect(client.join).not.toHaveBeenCalled();
  });

  it("releases the client and gives the seat back when the call can't connect", async () => {
    client.join.mockRejectedValueOnce(new Error("No media server"));
    api.join.mockResolvedValue(ok({ meeting: live({ you: { seat: "HELD" } }), provider: "fake", token: "t" }));
    await render(props({ meeting: live() }));
    await press($("[data-call-join]"));
    expect(client.leave).toHaveBeenCalledOnce();
    expect(api.leave).toHaveBeenCalledWith("call-1");
    expect(container.textContent).toContain("The call couldn't connect");
    expect(assertive()).toBe("The call couldn't connect. Check your connection and try again. Your place was given back.");
    expect($("[data-call-room]")).toBeNull();
  });

  it("gives the seat back when no client can load for the token's provider", async () => {
    load.fail = true;
    api.join.mockResolvedValue(ok({ meeting: live({ you: { seat: "HELD" } }), provider: "realtimekit", token: "t" }));
    await render(props({ meeting: live() }));
    await press($("[data-call-join]"));
    expect(api.leave).toHaveBeenCalledWith("call-1");
    expect(container.textContent).toContain("The call couldn't connect");
  });
});

describe("the pages instead of a call, and after it", () => {
  it("is full: says so with the recording's place and Try again, with focus on its h1", async () => {
    api.join.mockResolvedValue({ ok: false, kind: "conflict", message: "This call is full." });
    api.get.mockResolvedValue(ok(live({ seatsHeld: 15 })));
    await render(props({ meeting: live() }));
    await press($("[data-call-join]"));
    expect(heading().textContent).toBe("This session is full");
    expect(document.activeElement).toBe(heading());
    expect(container.textContent).toContain("You can watch the recording in Sessions afterwards.");
    expect(assertive()).toBe("This session is full");
    await press(button("Try again"));
    expect($("[data-call-join]")).not.toBeNull();
  });

  it("shows the end when a join finds the call over, and a removal when it was refused for one", async () => {
    api.join.mockResolvedValue({ ok: false, kind: "conflict", message: "This call has ended." });
    api.get.mockResolvedValue(ok(meeting({ state: "ENDED", endReason: "NO_HOST" })));
    await render(props({ meeting: live() }));
    await press($("[data-call-join]"));
    expect(heading().textContent).toBe("Session 10: Testing payment callbacks has ended");
    expect(container.textContent).toContain("It ended because no host was here. The recording will be in Sessions when it's ready.");

    act(() => root.unmount());
    root = createRoot(container);
    api.join.mockResolvedValue({ ok: false, kind: "missing" });
    api.get.mockResolvedValue(ok(live({ you: { seat: "REMOVED", canJoin: false } })));
    await render(props({ meeting: live() }));
    await press($("[data-call-join]"));
    expect(heading().textContent).toBe("A host removed you from this session");
  });

  it("shows an ended, cancelled or removed call on arrival, with focus on its h1 and nothing said", async () => {
    await render(props({ meeting: meeting({ state: "ENDED", endReason: "LIMIT" }) }));
    expect(heading().textContent).toBe("Session 10: Testing payment callbacks has ended");
    expect(container.textContent).toContain("It reached its 90-minute limit and ended.");
    expect(document.activeElement).toBe(heading());
    expect(assertive()).toBe("");
    expect(container.querySelector<HTMLAnchorElement>("a[href='/dashboard/cohort/sessions']")!.textContent).toBe("Back to Sessions");
    await render(props({ meeting: meeting({ state: "CANCELLED" }) }));
    expect(heading().textContent).toBe("Session 10: Testing payment callbacks was cancelled");
    await render(props({ meeting: live({ you: { seat: "REMOVED", canJoin: false } }) }));
    expect(heading().textContent).toBe("A host removed you from this session");
  });
});

describe("in the call", () => {
  it("is announced at its h1, with a skip link, the toolbar, and the recording said once a host opens it", async () => {
    await startAsHost();
    expect($("[data-call-room]")).not.toBeNull();
    expect(document.activeElement).toBe(heading());
    expect(heading().className).toContain("sr-only");
    expect(container.querySelector("a[href='#call-controls']")!.textContent).toBe("Skip to call controls");
    expect($("[role=toolbar]")!.getAttribute("aria-label")).toBe("Call controls");
    expect(assertive()).toBe("Recording started");
    expect(container.textContent).toContain("Ends at 19:29");
    expect(container.querySelectorAll("[data-variant=primary]")).toHaveLength(0);
  });

  it("says nothing about a recording that was already going when a member joins", async () => {
    await joinAsMember();
    await settle(1_100);
    expect(assertive()).toBe("");
    expect($("header")!.textContent).toContain("Recording");
  });

  it("says the recording stopping or failing at once, and the chip says it too", async () => {
    await joinAsMember();
    act(() => client.set({ recording: "failed" }));
    await settle(1_100);
    expect(assertive()).toBe("Recording stopped working. The session carries on, but the rest isn't being recorded.");
    expect($("header")!.textContent).toContain("Recording stopped working");
    act(() => client.set({ recording: "stopped" }));
    await settle(1_100);
    expect(assertive()).toBe("Recording stopped");
  });

  it("says a lost connection at once and its return politely, with a notice while it is away", async () => {
    await joinAsMember();
    act(() => client.set({ connection: "reconnecting" }));
    await settle(1_100);
    expect(assertive()).toBe("Connection lost. Trying to reconnect.");
    expect(container.textContent).toContain("Reconnecting…");
    act(() => client.set({ connection: "connected" }));
    await settle(1_100);
    expect(polite()).toBe("Connected again.");
    expect(container.textContent).not.toContain("Reconnecting…");
  });

  it("says a host muting you or stopping your share at once", async () => {
    await joinAsMember();
    act(() => client.notify("muted-by-host"));
    await settle(1_100);
    expect(assertive()).toBe("A host muted you. You can unmute yourself.");
    act(() => client.notify("share-stopped-by-host"));
    await settle(1_100);
    expect(assertive()).toBe("A host stopped your screen share.");
  });

  it("gathers people arriving and leaving into one polite sentence, unless the person turned that off", async () => {
    await joinAsMember();
    act(() => client.set({ participants: [...client.state.participants, person("kevin", "Kevin Omondi"), person("brian", "Brian Kiprop")] }));
    await settle(2_100);
    expect(polite()).toBe("Kevin Omondi and Brian Kiprop joined");
    await press(button("People"));
    await press($("input[name=sayArrivals]"));
    act(() => client.set({ participants: client.state.participants.filter(({ userId }) => userId !== "kevin") }));
    await settle(2_100);
    expect(polite()).toBe("Kevin Omondi and Brian Kiprop joined");
  });

  it("warns that a session with no host ends in five minutes, at once, then at one minute", async () => {
    await joinAsMember([person("kevin", "Kevin Omondi")]);
    await settle(1_100);
    expect(assertive()).toBe("No host is here. The session ends in 5 minutes unless a host comes back.");
    expect(container.textContent).toContain("5 min left");
    await settle(4 * 60_000 + 1_000);
    expect(assertive()).toBe("The session ends in 1 minute.");
    // A host coming back takes the warning away.
    act(() => client.set({ participants: [...client.state.participants, person(HOST, "Faith Njeri")] }));
    await settle();
    expect(container.textContent).not.toContain("No host is here");
  });

  it("says the 15-minute and 1-minute warnings of the call's own end", async () => {
    await joinAsMember(undefined, { hardEndAt: NOW + 15 * 60_000 + 1_000 });
    await settle(2_000);
    expect(polite()).toBe("The session ends in 15 minutes.");
    await settle(14 * 60_000);
    expect(assertive()).toBe("The session ends in 1 minute.");
  });

  it("asks the server about the call and ends when it says so, at the limit, releasing the client", async () => {
    await joinAsMember();
    api.get.mockResolvedValue(ok(meeting({ state: "ENDED", endReason: "LIMIT" })));
    await settle(ROOM_POLL_MS);
    expect(heading().textContent).toBe("Session 10: Testing payment callbacks has ended");
    expect(container.textContent).toContain("It reached its 90-minute limit and ended.");
    expect(document.activeElement).toBe(heading());
    await settle(1_100);
    expect(assertive()).toBe("Session 10: Testing payment callbacks has ended");
    expect(client.leave).toHaveBeenCalled();
  });

  it("goes to the removed page when the provider removes this person, saying so at once", async () => {
    await joinAsMember();
    act(() => client.notify("removed"));
    await settle(1_100);
    expect(heading().textContent).toBe("A host removed you from this session");
    expect(document.activeElement).toBe(heading());
    expect(assertive()).toBe("A host removed you from this session");
    expect(client.leave).toHaveBeenCalled();
  });

  it("learns why a call the provider ended ended, from the server", async () => {
    await joinAsMember();
    api.get.mockResolvedValue(ok(meeting({ state: "ENDED", endReason: "HOST_ENDED" })));
    act(() => client.notify("ended"));
    await settle();
    expect(container.textContent).toContain("A host ended the session.");
  });

  it("says when this person joined from somewhere else, and offers this tab back", async () => {
    await joinAsMember();
    act(() => client.notify("replaced"));
    await settle();
    expect(heading().textContent).toBe("You joined Session 10: Testing payment callbacks somewhere else");
    expect(button("Use this tab instead")).toBeDefined();
  });

  it("lets a member leave at once, giving the seat back, and join again", async () => {
    await joinAsMember();
    await press(button("Leave session"));
    expect(client.leave).toHaveBeenCalled();
    expect(api.leave).toHaveBeenCalledWith("call-1");
    expect(heading().textContent).toBe("You left Session 10: Testing payment callbacks");
    api.get.mockResolvedValue(ok(live()));
    await press(button("Join again"));
    expect($("[data-call-join]")).not.toBeNull();
  });

  it("asks a host before ending: Keep going first, Just leave only with another host in, then ends for everyone", async () => {
    await startAsHost([person(ME, "Wanjiku Mwangi")]);
    await press(button("Leave or end"));
    const dialog = $<HTMLDialogElement>("dialog#call-end")!;
    expect(dialog.open).toBe(true);
    expect(dialog.textContent).toContain("End Session 10: Testing payment callbacks for everyone?");
    expect(document.activeElement?.textContent).toBe("Keep going");
    expect(button("Just leave")).toBeUndefined();
    expect(dialog.textContent).toContain("You're the only host here");
    await press(button("Keep going"));
    expect(dialog.open).toBe(false);

    act(() => client.set({ participants: [...client.state.participants, person("amina", "Amina Hassan")] }));
    await press(button("Leave or end"));
    expect(button("Just leave")).toBeDefined();
    expect(dialog.textContent).toContain("If you just leave, another host keeps it going.");
    api.end.mockResolvedValue(ok(meeting({ state: "ENDED", endReason: "HOST_ENDED" })));
    await press(button("End for everyone"));
    expect(api.end).toHaveBeenCalledWith("call-1");
    expect(client.leave).toHaveBeenCalled();
    expect(heading().textContent).toBe("Session 10: Testing payment callbacks has ended");
  });

  it("keeps the call when ending fails, and says so", async () => {
    await startAsHost();
    api.end.mockResolvedValue({ ok: false, kind: "unavailable" });
    await press(button("Leave or end"));
    await press(button("End for everyone"));
    expect($("[data-call-room]")).not.toBeNull();
    expect(container.textContent).toContain("The session didn't end: the call service didn't answer.");
  });

  it("lets a host mute, stop a share and remove a member from People, removing after a confirm", async () => {
    await startAsHost([person("kevin", "Kevin Omondi", { sharing: true })]);
    await press(button("People"));
    const panel = $("[data-call-panel=people]")!;
    expect(document.activeElement).toBe(panel.querySelector("h2"));
    expect(panel.querySelector("h2")!.textContent).toBe("People · 2");
    expect(panel.textContent).toContain("Faith Njeri (you)");
    expect(panel.textContent).toContain("Sharing their screen");
    // No actions on a host or on yourself.
    expect(panel.querySelectorAll("[aria-label^='Actions for']")).toHaveLength(1);
    await press(button("Actions for Kevin Omondi"));
    await press([...document.querySelectorAll("[role=menuitem]")].find((item) => item.textContent === "Mute"));
    expect(client.muteParticipant).toHaveBeenCalledWith("kevin");
    await press(button("Actions for Kevin Omondi"));
    await press([...document.querySelectorAll("[role=menuitem]")].find((item) => item.textContent === "Stop their screen share"));
    expect(client.stopParticipantShare).toHaveBeenCalledWith("kevin");
    await press(button("Actions for Kevin Omondi"));
    await press([...document.querySelectorAll("[role=menuitem]")].find((item) => item.textContent === "Remove from session"));
    const confirm = $<HTMLDialogElement>("dialog#call-remove")!;
    expect(confirm.open).toBe(true);
    expect(confirm.textContent).toContain("Remove Kevin Omondi from this session?");
    api.remove.mockResolvedValue(ok(live()));
    await press(button("Remove"));
    expect(api.remove).toHaveBeenCalledWith("call-1", "kevin");
    await settle(1_100);
    expect(polite()).toBe("Kevin Omondi was removed from the session.");
  });

  it("gives no host actions to a member", async () => {
    await joinAsMember([person(HOST, "Faith Njeri"), person("kevin", "Kevin Omondi")]);
    await press(button("People"));
    expect($("[data-call-panel=people]")!.querySelectorAll("[aria-label^='Actions for']")).toHaveLength(0);
    expect($("[data-call-panel=people]")!.textContent).toContain("Host");
  });

  it("opens one panel at a time; Escape closes it, never the call, and focus goes back to its button", async () => {
    await joinAsMember();
    await press(button("Chat"));
    const chat = $("[data-call-panel=chat]")!;
    const link = chat.querySelector<HTMLAnchorElement>("a")!;
    expect(link.getAttribute("href")).toBe("/dashboard/cohort/c/cohort-04?thread=card");
    expect(link.target).toBe("_blank");
    expect(link.textContent).toBe("Open the thread (opens in a new tab)");
    expect(button("Chat")!.getAttribute("aria-expanded")).toBe("true");
    await press(button("People"));
    expect(container.querySelectorAll("[data-call-panel]")).toHaveLength(1);
    expect($("[data-call-panel=people]")).not.toBeNull();
    await key(document.activeElement!, "Escape");
    expect(container.querySelectorAll("[data-call-panel]")).toHaveLength(0);
    expect(document.activeElement).toBe(button("People"));
    expect($("[data-call-room]")).not.toBeNull();
  });

  it("is one toolbar: one Tab stop, the arrows, Home and End move in it", async () => {
    await joinAsMember();
    const toolbar = $("[role=toolbar]")!;
    const stops = () => [...toolbar.querySelectorAll("button")].filter((control) => control.tabIndex === 0).map((control) => control.textContent);
    expect(stops()).toEqual(["Mute"]);
    button("Mute")!.focus();
    await key(document.activeElement!, "ArrowRight");
    expect(document.activeElement).toBe(button("Turn camera off"));
    await key(document.activeElement!, "End");
    expect(document.activeElement).toBe(button("Leave session"));
    await key(document.activeElement!, "ArrowRight");
    expect(document.activeElement).toBe(button("Mute"));
    await key(document.activeElement!, "ArrowLeft");
    expect(document.activeElement).toBe(button("Leave session"));
    await key(document.activeElement!, "Home");
    expect(document.activeElement).toBe(button("Mute"));
    expect(stops()).toEqual(["Mute"]);
  });

  it("names each toggle by what pressing it does", async () => {
    await joinAsMember();
    await press(button("Mute"));
    expect(client.setMicrophone).toHaveBeenCalledWith(false);
    expect(button("Unmute")).toBeDefined();
    await press(button("Turn camera off"));
    expect(client.setCamera).toHaveBeenCalledWith(false);
    expect(button("Turn camera on")).toBeDefined();
    await press(button("Share screen"));
    expect(button("Stop sharing")).toBeDefined();
    expect($("[data-call-screen]")!.textContent).toContain("You're sharing your screen");
  });

  it("says a phone browser can't share a screen rather than hiding the option, and a share that's taken", async () => {
    client.canShareScreen = false;
    await joinAsMember();
    await press(button("Share screen"));
    expect(container.textContent).toContain("Phone browsers can't share a screen. Join from a computer to share yours.");
    await settle(1_100);
    expect(polite()).toBe("This browser can't share a screen. Join from a computer to share yours.");
    client.canShareScreen = true;
    client.startScreenShare.mockRejectedValueOnce(new ScreenShareError("taken", "Faith Njeri is sharing."));
    await press(button("Share screen"));
    expect(container.textContent).toContain("Faith Njeri is sharing. You can share when they stop.");
  });

  it("puts a shared screen first, with everyone in a strip under it", async () => {
    await joinAsMember([person(HOST, "Faith Njeri", { sharing: true })]);
    expect($("[data-call-screen]")!.textContent).toContain("Faith Njeri's screen");
    expect($("[data-call-strip]")!.querySelectorAll("[data-call-tile]")).toHaveLength(2);
    expect($("[data-call-grid]")).toBeNull();
  });

  it("gives every tile words for muted, speaking and host, never colour alone", async () => {
    await joinAsMember([person(HOST, "Faith Njeri", { speaking: true }), person("kevin", "Kevin Omondi", { microphoneOn: false })]);
    expect($("[data-call-tile=faith]")!.textContent).toContain("host, speaking");
    expect($("[data-call-tile=kevin]")!.textContent).toContain(", muted");
    expect($("[data-call-tile=faith]")!.getAttribute("data-speaking")).toBe("true");
  });
});

describe("cleanup", () => {
  it("releases the client when the island goes mid-call, and asks before the page is left", async () => {
    const added = vi.spyOn(window, "addEventListener");
    const removed = vi.spyOn(window, "removeEventListener");
    await joinAsMember();
    expect(added.mock.calls.map(([type]) => type)).toEqual(expect.arrayContaining(["beforeunload", "pagehide"]));
    const ask = added.mock.calls.find(([type]) => String(type) === "beforeunload")![1] as (event: Event) => void;
    const event = new Event("beforeunload", { cancelable: true });
    ask(event);
    expect(event.defaultPrevented).toBe(true);
    const gone = added.mock.calls.find(([type]) => String(type) === "pagehide")![1] as () => void;
    gone();
    expect(api.leaveOnExit).toHaveBeenCalledWith("call-1");
    act(() => root.unmount());
    expect(client.leave).toHaveBeenCalled();
    expect(removed.mock.calls.map(([type]) => type)).toEqual(expect.arrayContaining(["beforeunload", "pagehide"]));
    root = createRoot(container);
  });

  it("stops asking the server once the call is over", async () => {
    await joinAsMember();
    api.get.mockResolvedValue(ok(meeting({ state: "ENDED", endReason: "HOST_ENDED" })));
    await settle(ROOM_POLL_MS);
    api.get.mockClear();
    await settle(ROOM_POLL_MS * 3);
    expect(api.get).not.toHaveBeenCalled();
  });
});
