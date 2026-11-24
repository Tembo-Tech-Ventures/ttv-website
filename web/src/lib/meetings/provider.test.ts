import { describe, expect, it } from "vitest";
import { callProviderFor, CallProviderError, FakeCallProvider } from "./provider";

describe("the fake call provider", () => {
  it("mints tokens only for an open meeting's participants, and deleting a participant kills their tokens", async () => {
    const provider = new FakeCallProvider();
    const { providerMeetingId } = await provider.createMeeting({ title: "Week 9" });
    const wanjiku = await provider.addParticipant({ providerMeetingId, userId: "synthetic-wanjiku", name: "Wanjiku" });
    const otieno = await provider.addParticipant({ providerMeetingId, userId: "synthetic-otieno", name: "Otieno" });
    expect(provider.present(providerMeetingId)).toEqual(["synthetic-otieno", "synthetic-wanjiku"]);
    await provider.deleteParticipant({ providerMeetingId, participantId: wanjiku.participantId });
    await provider.deleteParticipant({ providerMeetingId, participantId: wanjiku.participantId });
    expect(provider.liveToken(wanjiku.token)).toBe(false);
    expect(provider.liveToken(otieno.token)).toBe(true);
  });

  it("removes everyone when a meeting ends, admits nobody after, and ends twice without complaint", async () => {
    const provider = new FakeCallProvider();
    const { providerMeetingId } = await provider.createMeeting({ title: "Week 9" });
    const { token } = await provider.addParticipant({ providerMeetingId, userId: "synthetic-wanjiku", name: "Wanjiku" });
    const { providerRecordingId } = await provider.startRecording({ providerMeetingId, maxSeconds: 60 });
    await provider.endMeeting({ providerMeetingId });
    await provider.endMeeting({ providerMeetingId });
    expect(provider.liveToken(token)).toBe(false);
    expect(provider.meetings.get(providerMeetingId)?.recordings.get(providerRecordingId)?.recording).toBe(false);
    await expect(provider.addParticipant({ providerMeetingId, userId: "synthetic-otieno", name: "Otieno" })).rejects.toBeInstanceOf(CallProviderError);
    await expect(provider.startRecording({ providerMeetingId, maxSeconds: 60 })).rejects.toBeInstanceOf(CallProviderError);
  });

  it("records once at a time, and treats a meeting another isolate made as open", async () => {
    const provider = new FakeCallProvider();
    const providerMeetingId = "fake-meeting-from-another-isolate";
    await provider.addParticipant({ providerMeetingId, userId: "synthetic-wanjiku", name: "Wanjiku" });
    const { providerRecordingId } = await provider.startRecording({ providerMeetingId, maxSeconds: 60 });
    await expect(provider.startRecording({ providerMeetingId, maxSeconds: 60 })).rejects.toThrow("already recording");
    await provider.stopRecording({ providerMeetingId, providerRecordingId });
    await provider.stopRecording({ providerMeetingId, providerRecordingId });
    expect((await provider.startRecording({ providerMeetingId, maxSeconds: 60 })).providerRecordingId).not.toBe(providerRecordingId);
  });

  it("fails the next call of an operation when asked, once", async () => {
    const provider = new FakeCallProvider();
    provider.failNext("createMeeting");
    await expect(provider.createMeeting({ title: "Week 9" })).rejects.toMatchObject({ operation: "createMeeting" });
    await expect(provider.createMeeting({ title: "Week 9" })).resolves.toHaveProperty("providerMeetingId");
  });
});

describe("callProviderFor", () => {
  it("uses the fake everywhere but production, which has no provider until the real one is set up", () => {
    for (const environment of [undefined, "", "staging", "agent-pr-430", "local"]) {
      expect(callProviderFor({ DEPLOYMENT_ENVIRONMENT: environment })?.kind).toBe("fake");
    }
    for (const environment of ["production", "Production", " production "]) {
      expect(callProviderFor({ DEPLOYMENT_ENVIRONMENT: environment })).toBeNull();
    }
  });
});
