import { describe, expect, it } from "vitest";
import type { Meeting } from "@/lib/platform/contracts";
import { presenceRecording } from "./fake-presence";
import {
  endedText, fullText, gateScreen, joinLabel, noHostText, overAnnouncement, peopleCount, recordingAnnouncement, recordingChip,
  recordingNotice, removedText, ROOM_OPENS_EARLY_MINUTES, tooEarlyText, waitingText,
} from "./room-model";

const START = Date.parse("2026-11-27T15:00:00Z");
const MINUTE = 60_000;

function meeting(overrides: Partial<Omit<Meeting, "you">> & { you?: Partial<Meeting["you"]> } = {}): Meeting {
  const { you, ...rest } = overrides;
  return {
    id: "m", channelId: "c", purpose: "SESSION", title: "Session 10: Testing payment callbacks", scheduledStartAt: START,
    bookedMinutes: 60, limitMinutes: 90, recordingPolicy: "ALWAYS", state: "SCHEDULED", openedAt: null, hardEndAt: null,
    endedAt: null, endReason: null, seatsHeld: 0, now: START, ...rest,
    you: { canJoin: false, canHost: false, seat: null, role: null, ...you },
  };
}

describe("which screen a call shows before joining", () => {
  it("lets a host start from ROOM_OPENS_EARLY_MINUTES before the booked start, and says when before that", () => {
    const host = meeting({ you: { canHost: true, canJoin: true } });
    const opensAt = START - ROOM_OPENS_EARLY_MINUTES * MINUTE;
    expect(gateScreen(host, opensAt - 1, false)).toEqual({ kind: "too-early", opensAt });
    expect(gateScreen(host, opensAt, false)).toEqual({ kind: "ready", start: true });
  });

  it("has a member wait for a host until the room opens, then join", () => {
    expect(gateScreen(meeting(), START, false)).toEqual({ kind: "waiting" });
    expect(gateScreen(meeting({ state: "LIVE", you: { canJoin: true } }), START, false)).toEqual({ kind: "ready", start: false });
  });

  it("shows the end, a removal, an archived channel and a place with no calls for what they are", () => {
    expect(gateScreen(meeting({ state: "ENDED", endReason: "LIMIT" }), START, false)).toEqual({ kind: "ended", reason: "LIMIT", cancelled: false });
    expect(gateScreen(meeting({ state: "CANCELLED" }), START, false)).toEqual({ kind: "ended", reason: null, cancelled: true });
    expect(gateScreen(meeting({ state: "LIVE", you: { seat: "REMOVED" } }), START, false)).toEqual({ kind: "removed" });
    expect(gateScreen(meeting({ state: "LIVE" }), START, false)).toEqual({ kind: "closed" });
    expect(gateScreen(meeting({ state: "LIVE", you: { canJoin: true } }), START, true)).toEqual({ kind: "unavailable" });
    // A removed person sees the removal even after the call ended.
    expect(gateScreen(meeting({ state: "ENDED", you: { seat: "REMOVED" } }), START, false)).toEqual({ kind: "removed" });
  });

  it("names the button by what it does and what the call is", () => {
    expect(joinLabel("SESSION", true)).toBe("Start session");
    expect(joinLabel("SESSION", false)).toBe("Join session");
    expect(joinLabel("CALL", false)).toBe("Join call");
    expect(joinLabel("EVENT", true)).toBe("Start event");
  });
});

describe("what is said about the recording before joining (UX-REVIEW §6)", () => {
  it("says a cohort session is recorded from start to end, who can watch it, and what is in it", () => {
    const notice = recordingNotice(meeting(), "Cohort 04", false);
    expect(notice.title).toBe("This session is recorded");
    expect(notice.body).toContain("Everyone in Cohort 04 can watch it and read the transcript afterwards");
    expect(notice.body).toContain("Your voice, your camera if it's on, and anything you share are in the recording. The chat isn't.");
  });

  it("tells someone joining late since when it has been recorded, in Nairobi time", () => {
    const live = meeting({ state: "LIVE", openedAt: Date.parse("2026-11-27T15:04:00Z") });
    expect(recordingNotice(live, "Cohort 04", false).title).toBe("This session is being recorded, since 18:04 EAT");
  });

  it("says an event is recorded by joining, a call between two people isn't yet, and the monthly limit", () => {
    expect(recordingNotice(meeting({ purpose: "EVENT", recordingPolicy: "HOST" }), null, false).body).toContain("By joining, you agree to be recorded");
    expect(recordingNotice(meeting({ purpose: "EVENT", recordingPolicy: "NONE" }), null, false).title).toBe("This event isn't recorded");
    expect(recordingNotice(meeting({ purpose: "CALL", recordingPolicy: "BOTH_AGREE" }), null, false).title).toBe("This call isn't recorded");
    expect(recordingNotice(meeting(), "Cohort 04", true)).toEqual({
      title: "This session isn't recorded", body: "TTV has reached its recording limit for this month, so nothing in this call is recorded.",
    });
  });
});

describe("the recording in the room", () => {
  it("always carries its state in words, and is said at once when it changes", () => {
    expect(recordingChip("recording", false)).toEqual({ label: "Recording", tone: "danger" });
    expect(recordingChip("failed", false)).toEqual({ label: "Recording stopped working", tone: "warning" });
    expect(recordingChip("stopped", false)).toEqual({ label: "Recording stopped", tone: "neutral" });
    expect(recordingChip("off", false)).toBeNull();
    expect(recordingChip("off", true)).toEqual({ label: "Not recorded", tone: "neutral" });
    expect(recordingAnnouncement("recording", "SESSION")).toBe("Recording started");
    expect(recordingAnnouncement("stopped", "SESSION")).toBe("Recording stopped");
    expect(recordingAnnouncement("failed", "SESSION")).toBe("Recording stopped working. The session carries on, but the rest isn't being recorded.");
    expect(recordingAnnouncement("off", "SESSION")).toBeNull();
  });

  it("matches what the fake provider reports to the call's recording row, or its policy", () => {
    expect(presenceRecording("ALWAYS", "LIVE", null)).toBe("recording");
    expect(presenceRecording("ALWAYS", "SCHEDULED", null)).toBe("off");
    expect(presenceRecording("BOTH_AGREE", "LIVE", null)).toBe("off");
    expect(presenceRecording("HOST", "LIVE", "RECORDING")).toBe("recording");
    expect(presenceRecording("ALWAYS", "LIVE", "STARTING")).toBe("recording");
    expect(presenceRecording("ALWAYS", "LIVE", "STOPPED")).toBe("stopped");
    expect(presenceRecording("ALWAYS", "LIVE", "PROMOTED")).toBe("stopped");
    expect(presenceRecording("ALWAYS", "LIVE", "TOO_SHORT")).toBe("stopped");
    expect(presenceRecording("ALWAYS", "LIVE", "FAILED")).toBe("failed");
    expect(presenceRecording("ALWAYS", "LIVE", "REFUSED")).toBe("off");
  });
});

describe("the pages after a call", () => {
  const call = meeting();

  it("separates the ways a call ends, and says where the recording will be", () => {
    expect(endedText(call, "HOST_ENDED", false, false)).toEqual({
      title: "Session 10: Testing payment callbacks has ended",
      body: "A host ended the session. The recording will be in Sessions when it's ready.",
    });
    expect(endedText(call, "LIMIT", false, false).body).toBe("It reached its 90-minute limit and ended. The recording will be in Sessions when it's ready.");
    expect(endedText(call, "NO_HOST", false, false).body).toBe("It ended because no host was here. The recording will be in Sessions when it's ready.");
    expect(endedText(meeting({ purpose: "CALL", recordingPolicy: "BOTH_AGREE" }), "NOBODY_CAME", false, false).body)
      .toBe("The other person didn't join, so the call closed. You can suggest another time.");
    expect(endedText(meeting({ purpose: "EVENT", recordingPolicy: "HOST" }), "EMPTY", false, false).body)
      .toBe("Everyone had left, so it closed. The recording will be in the channel when it's ready.");
    // Nothing recorded, nothing promised.
    expect(endedText(call, "HOST_ENDED", false, true).body).toBe("A host ended the session.");
    expect(endedText(call, null, true, false)).toEqual({ title: "Session 10: Testing payment callbacks was cancelled", body: "This session didn't take place." });
  });

  it("says full, removed, waiting, too early and no host in the voice's words", () => {
    expect(fullText("SESSION", true)).toEqual({
      title: "This session is full",
      body: "Up to 15 people can be in a call, with one place kept for a host. You can watch the recording in Sessions afterwards. A place opens when someone leaves.",
    });
    expect(fullText("EVENT", false).body).not.toContain("recording");
    expect(removedText("SESSION")).toEqual({ title: "A host removed you from this session", body: "You can't rejoin it. If you think this was a mistake, tell the cohort's staff." });
    expect(waitingText("SESSION").title).toBe("A host hasn't started the session yet");
    expect(tooEarlyText("SESSION", "17:50")).toBe("You can start this session from 17:50 EAT, 10 minutes before it begins.");
    expect(noHostText("SESSION")).toBe("No host is here. The session ends in 5 minutes unless a host comes back.");
    expect(peopleCount(1)).toBe("1 person");
    expect(peopleCount(3)).toBe("3 people");
  });

  it("says each end screen as it appears", () => {
    expect(overAnnouncement({ kind: "ended", reason: "LIMIT", cancelled: false }, call)).toBe("Session 10: Testing payment callbacks has ended");
    expect(overAnnouncement({ kind: "removed" }, call)).toBe("A host removed you from this session");
    expect(overAnnouncement({ kind: "full" }, call)).toBe("This session is full");
    expect(overAnnouncement({ kind: "left" }, call)).toBe("You left the session");
    expect(overAnnouncement({ kind: "replaced" }, call)).toBe("You joined this session somewhere else");
  });
});
