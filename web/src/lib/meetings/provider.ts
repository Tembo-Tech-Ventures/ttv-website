import { isProduction } from "@/lib/platform/server/flags";
import type { CallProviderKind } from "./rules";

/**
 * The media provider behind a call (README.md beside this file, "The provider"). TTV decides who may
 * join, host and record; the provider only carries the media, and only for a participant TTV added.
 * Every call here is made by the server from TTV's own rows: no browser ever supplies a provider
 * meeting, participant, recording, preset, role or storage setting. The one preset (no recording
 * from the browser, no provider chat) and the recording storage belong to the adapter and the
 * provider's app, never to a request.
 *
 * The real RealtimeKit adapter is slice P4. Until then, and always in local runs, tests and previews,
 * the fake below serves; production gets no provider at all, so its calls answer 503 rather than
 * pretend to connect anyone.
 */

export interface CallProvider {
  readonly kind: CallProviderKind;
  /** A new provider meeting, made only when a host first opens the room: they can never be deleted. */
  createMeeting(input: { title: string }): Promise<{ providerMeetingId: string }>;
  /** Adds one person to a live provider meeting and returns their token. Only ever for a held seat. */
  addParticipant(input: { providerMeetingId: string; userId: string; name: string }): Promise<{ participantId: string; token: string }>;
  /** Removes a participant and revokes every token they hold, at once. Removing one already gone succeeds. */
  deleteParticipant(input: { providerMeetingId: string; participantId: string }): Promise<void>;
  /** Removes everyone and closes the meeting to new joins and sessions. Ending an ended meeting succeeds. */
  endMeeting(input: { providerMeetingId: string }): Promise<void>;
  /** Starts the meeting's one recording, which stops by itself after maxSeconds. */
  startRecording(input: { providerMeetingId: string; maxSeconds: number }): Promise<{ providerRecordingId: string }>;
  /** Stops a recording. Stopping a stopped one succeeds. */
  stopRecording(input: { providerMeetingId: string; providerRecordingId: string }): Promise<void>;
}

/** A provider call that failed: the caller keeps TTV's rows consistent and answers with a retry. */
export class CallProviderError extends Error {
  constructor(readonly operation: keyof Omit<CallProvider, "kind">, message: string) {
    super(message);
  }
}

type Operation = CallProviderError["operation"];

interface FakeMeeting {
  title: string;
  active: boolean;
  /** participantId → the person and their token. */
  participants: Map<string, { userId: string; token: string }>;
  /** providerRecordingId → whether it is still recording. */
  recordings: Map<string, { recording: boolean; maxSeconds: number }>;
}

/**
 * An in-memory provider with the real one's rules: tokens are minted only for a participant of an
 * open meeting, deleting a participant kills their tokens, ending a meeting removes everyone and
 * admits nobody again, and a meeting records once at a time. Its state lives in one isolate, which is
 * all a preview needs: TTV's seats, not the provider, are the record of who may be in a call. Tests
 * read `log` and `liveToken`, and make the next call of an operation fail with `failNext`.
 */
export class FakeCallProvider implements CallProvider {
  readonly kind = "fake" as const;
  readonly meetings = new Map<string, FakeMeeting>();
  readonly log: { operation: Operation; providerMeetingId?: string; participantId?: string }[] = [];
  readonly #failing = new Set<Operation>();

  /** The next call of `operation` throws a CallProviderError, as an unreachable provider would. */
  failNext(operation: Operation): void {
    this.#failing.add(operation);
  }

  /** Whether a token still admits its holder: their participant exists in a meeting still open. */
  liveToken(token: string): boolean {
    for (const meeting of this.meetings.values()) {
      if (!meeting.active) continue;
      for (const participant of meeting.participants.values()) if (participant.token === token) return true;
    }
    return false;
  }

  /** The people in a provider meeting right now, by TTV user id. */
  present(providerMeetingId: string): string[] {
    return [...this.meetings.get(providerMeetingId)?.participants.values() ?? []].map(({ userId }) => userId).toSorted();
  }

  async createMeeting({ title }: { title: string }) {
    this.#enter("createMeeting");
    const providerMeetingId = `fake-meeting-${crypto.randomUUID()}`;
    this.meetings.set(providerMeetingId, { title, active: true, participants: new Map(), recordings: new Map() });
    this.log.push({ operation: "createMeeting", providerMeetingId });
    return { providerMeetingId };
  }

  async addParticipant({ providerMeetingId, userId }: { providerMeetingId: string; userId: string; name: string }) {
    this.#enter("addParticipant");
    const meeting = this.#active(providerMeetingId, "addParticipant");
    const participantId = `fake-participant-${crypto.randomUUID()}`;
    const token = `fake.${crypto.randomUUID()}`;
    meeting.participants.set(participantId, { userId, token });
    this.log.push({ operation: "addParticipant", providerMeetingId, participantId });
    return { participantId, token };
  }

  async deleteParticipant({ providerMeetingId, participantId }: { providerMeetingId: string; participantId: string }) {
    this.#enter("deleteParticipant");
    this.meetings.get(providerMeetingId)?.participants.delete(participantId);
    this.log.push({ operation: "deleteParticipant", providerMeetingId, participantId });
  }

  async endMeeting({ providerMeetingId }: { providerMeetingId: string }) {
    this.#enter("endMeeting");
    const meeting = this.meetings.get(providerMeetingId);
    if (meeting) {
      meeting.active = false;
      meeting.participants.clear();
      for (const recording of meeting.recordings.values()) recording.recording = false;
    }
    this.log.push({ operation: "endMeeting", providerMeetingId });
  }

  async startRecording({ providerMeetingId, maxSeconds }: { providerMeetingId: string; maxSeconds: number }) {
    this.#enter("startRecording");
    const meeting = this.#active(providerMeetingId, "startRecording");
    if ([...meeting.recordings.values()].some(({ recording }) => recording)) {
      throw new CallProviderError("startRecording", "This meeting is already recording.");
    }
    const providerRecordingId = `fake-recording-${crypto.randomUUID()}`;
    meeting.recordings.set(providerRecordingId, { recording: true, maxSeconds });
    this.log.push({ operation: "startRecording", providerMeetingId });
    return { providerRecordingId };
  }

  async stopRecording({ providerMeetingId, providerRecordingId }: { providerMeetingId: string; providerRecordingId: string }) {
    this.#enter("stopRecording");
    const recording = this.meetings.get(providerMeetingId)?.recordings.get(providerRecordingId);
    if (recording) recording.recording = false;
    this.log.push({ operation: "stopRecording", providerMeetingId });
  }

  #enter(operation: Operation) {
    if (this.#failing.delete(operation)) throw new CallProviderError(operation, `The fake provider failed ${operation}, as asked.`);
  }

  /**
   * A meeting another isolate made is open here too: TTV's rows already said it is live, and a
   * preview runs several isolates. One this isolate saw end stays ended.
   */
  #active(providerMeetingId: string, operation: Operation): FakeMeeting {
    let meeting = this.meetings.get(providerMeetingId);
    if (!meeting) {
      meeting = { title: "", active: true, participants: new Map(), recordings: new Map() };
      this.meetings.set(providerMeetingId, meeting);
    }
    if (!meeting.active) throw new CallProviderError(operation, "This meeting is not open.");
    return meeting;
  }
}

/** One fake per isolate, shared by its requests. */
let sharedFake: FakeCallProvider | undefined;

/**
 * The provider this Worker's calls use: the fake everywhere but production, which has none until the
 * RealtimeKit adapter and its settings arrive (P4). Never a pretend call in production.
 */
export function callProviderFor(env: Pick<Cloudflare.Env, "DEPLOYMENT_ENVIRONMENT">): CallProvider | null {
  if (isProduction(env)) return null;
  sharedFake ??= new FakeCallProvider();
  return sharedFake;
}
