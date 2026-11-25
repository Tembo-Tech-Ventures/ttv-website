import { useEffect, useRef, useState, type ReactNode } from "react";
import { PiMicrophone, PiSpeakerHigh, PiVideoCamera } from "react-icons/pi";
import {
  Avatar, Button, ButtonLink, Checkbox, Chip, Disclosure, Notice, PageTitle, SelectField, cx,
} from "@/components/platform/ui";
import {
  audioMeter, deviceProblem, deviceProblemText, listDevices, mediaDevices, openDevice, playTestSound, stopStream,
  type DeviceKind, type DeviceOption, type DeviceProblem,
} from "@/lib/meetings/devices";
import type { MediaChoice } from "@/lib/meetings/room-client";
import type { MeetingPurpose } from "@/lib/meetings/rules";
import {
  joinLabel, nairobiTime, recordingNotice, tooEarlyText, waitingText, type CallRoomProps, type GateScreen,
} from "@/lib/meetings/room-model";
import { MAX_PEOPLE_PER_CALL } from "@/lib/meetings/rules";

/**
 * The page before a call (UX-REVIEW §3, screen 06): the call's name, what is recorded, Join, and a
 * device check with the browser's own camera and microphone (no provider SDK). On a phone, Join and
 * the recording notice come first and the device choices fold into a Disclosure. Joining with the
 * camera off, or audio only for low data, is always offered, and so is joining when the browser
 * blocked a device. Every stream opened here is released on Join and when the page goes.
 */

type Preview = { stream: MediaStream | null; problem: DeviceProblem | null };
const NONE: Preview = { stream: null, problem: null };

export interface PreJoinProps {
  room: CallRoomProps;
  screen: Extract<GateScreen, { kind: "ready" | "too-early" | "waiting" | "closed" | "unavailable" }>;
  joining: boolean;
  /** Why the last Join failed, said in a notice above it. */
  failure: { title: string; body: string } | null;
  /** The server asked for the code of conduct first. */
  conductNeeded: boolean;
  onJoin: (choice: MediaChoice) => void;
}

/** A device preview: opened once the browser lets the page ask, released when the choice changes and on unmount. */
function useDevice(kind: DeviceKind, deviceId: string | null, wanted: boolean): Preview & { retry: () => void } {
  const [preview, setPreview] = useState<Preview>(NONE);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const media = mediaDevices();
    if (!wanted) return;
    if (!media) {
      setPreview({ stream: null, problem: "unsupported" });
      return;
    }
    let live = true;
    let opened: MediaStream | null = null;
    void (async () => {
      try {
        const stream = await openDevice(media, kind, deviceId);
        opened = stream;
        if (live) setPreview({ stream, problem: null });
        else stopStream(stream);
      } catch (error) {
        if (live) setPreview({ stream: null, problem: deviceProblem(error) });
      }
    })();
    return () => {
      live = false;
      stopStream(opened);
      setPreview(NONE);
    };
  }, [kind, deviceId, wanted, attempt]);
  return { ...preview, retry: () => setAttempt((count) => count + 1) };
}

/** How loud the microphone is, 0–1, while it is open. */
function useLevel(stream: MediaStream | null): number {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    const track = stream?.getAudioTracks()[0];
    const meter = track ? audioMeter(track) : null;
    if (!meter) return;
    const timer = setInterval(() => setLevel(meter.level()), 150);
    return () => {
      clearInterval(timer);
      meter.close();
      setLevel(0);
    };
  }, [stream]);
  return level;
}

function VideoPreview({ stream, name, userId, image }: { stream: MediaStream | null; name: string; userId: string; image: string | null }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (video.current) video.current.srcObject = stream;
  }, [stream]);
  return (
    <div className="relative flex aspect-video w-full items-center justify-center overflow-hidden rounded-[1.125rem] bg-ground" data-camera-preview>
      {stream
        ? <video ref={video} autoPlay playsInline muted className="h-full w-full -scale-x-100 object-cover" aria-label="Your camera" />
        : <Avatar id={userId} name={name} src={image ?? undefined} size="xl" decorative />}
    </div>
  );
}

function DeviceNotice({ kind, problem, action }: { kind: DeviceKind; problem: DeviceProblem; action?: ReactNode }) {
  const text = deviceProblemText(kind, problem);
  return <Notice tone="warning" title={text.title} actions={action}>{text.body}</Notice>;
}

/** The join button's line: why it is off, or what joining means. */
function joinReason(screen: PreJoinProps["screen"], purpose: MeetingPurpose): string {
  switch (screen.kind) {
    case "waiting": return waitingText(purpose).title;
    case "too-early": return tooEarlyText(purpose, nairobiTime(screen.opensAt));
    case "closed": return "This call's channel is archived, so it can't be joined.";
    case "unavailable": return "Calls aren't available here yet.";
    case "ready": return "Keep this tab open while you're in it: leaving the page leaves the call.";
  }
}

/** The choices made before joining, kept by the page while it waits. */
interface Choices {
  microphoneOff: boolean;
  cameraOff: boolean;
  audioOnly: boolean;
}

function JoinChoices({ choices, onChange, disabled }: { choices: Choices; onChange: (next: Choices) => void; disabled: boolean }) {
  const set = (key: keyof Choices) => (event: { currentTarget: HTMLInputElement }) => onChange({ ...choices, [key]: event.currentTarget.checked });
  return (
    <fieldset className="m-0 flex flex-col gap-3 border-0 p-0" disabled={disabled}>
      <legend className="mb-2 text-sm font-semibold text-ink-primary">When you join</legend>
      <Checkbox name="microphoneOff" label="Join with my microphone off" checked={choices.microphoneOff} onChange={set("microphoneOff")} />
      <Checkbox name="cameraOff" label="Join with my camera off" checked={choices.cameraOff || choices.audioOnly} disabled={choices.audioOnly} onChange={set("cameraOff")} />
      <Checkbox
        name="audioOnly" label="Low data: audio only" checked={choices.audioOnly} onChange={set("audioOnly")}
        hint="You hear everyone and see shared screens, with no video of people."
      />
    </fieldset>
  );
}

function Heading({ room }: { room: CallRoomProps }) {
  const { meeting } = room;
  return (
    <div className="flex min-w-0 flex-col gap-3">
      <PageTitle>{meeting.title}</PageTitle>
      <div className="flex flex-wrap gap-2">
        {room.cohortName && <Chip>{room.cohortName}</Chip>}
        {meeting.state === "LIVE" ? <Chip tone="peach">Live now</Chip> : <Chip>Starts {nairobiTime(meeting.scheduledStartAt)} EAT</Chip>}
        {meeting.state === "LIVE" && <Chip>{meeting.seatsHeld} of {MAX_PEOPLE_PER_CALL} places taken</Chip>}
      </div>
    </div>
  );
}

function ConductNotice({ href }: { href: string }) {
  return (
    <Notice tone="warning" title="Agree to how we talk to each other first" actions={
      <ButtonLink variant="quiet" size="sm" href={href} target="_blank" rel="noopener">
        Read it and agree<span className="sr-only"> (opens in a new tab)</span>
      </ButtonLink>
    }>
      Calls follow the same habits as the channels. Agree once, then come back and join.
    </Notice>
  );
}

/** The camera preview, what went wrong with a device, the microphone's level and the device choices. */
function DeviceCheck({ self, microphone, camera, cameraWanted, onCameraOff, level, devices, microphoneId, cameraId, onMicrophoneId, onCameraId }: {
  self: CallRoomProps["self"];
  microphone: ReturnType<typeof useDevice>;
  camera: ReturnType<typeof useDevice>;
  cameraWanted: boolean;
  onCameraOff: () => void;
  level: number;
  devices: Record<DeviceKind, DeviceOption[]>;
  microphoneId: string | null;
  cameraId: string | null;
  onMicrophoneId: (id: string | null) => void;
  onCameraId: (id: string | null) => void;
}) {
  const options = (kind: DeviceKind) => [{ value: "", label: "Browser's default" }, ...devices[kind].map(({ deviceId, label }) => ({ value: deviceId, label }))];
  return (
    <section aria-labelledby="call-devices-title" className="flex min-w-0 flex-col gap-4" data-call-devices>
      <h2 id="call-devices-title" className="m-0 text-lg text-ink-primary">Your camera and microphone</h2>
      <VideoPreview stream={camera.stream} name={self.name} userId={self.userId} image={self.image} />
      {camera.problem && cameraWanted && (
        <DeviceNotice kind="camera" problem={camera.problem} action={
          <>
            <Button size="sm" onClick={onCameraOff}>Join without camera</Button>
            <Button size="sm" variant="ghost" onClick={camera.retry}>Try again</Button>
          </>
        } />
      )}
      {microphone.problem && (
        <DeviceNotice kind="microphone" problem={microphone.problem} action={<Button size="sm" variant="ghost" onClick={microphone.retry}>Try again</Button>} />
      )}
      <div className="flex items-center gap-3 text-sm text-ink-secondary">
        <PiMicrophone aria-hidden="true" className="shrink-0" />
        <label htmlFor="call-mic-level">Microphone level</label>
        <meter id="call-mic-level" min={0} max={1} value={level} className={cx("h-2 w-32 min-w-0", !microphone.stream && "opacity-60")}>
          {Math.round(level * 100)}%
        </meter>
      </div>
      <Disclosure summary="Choose a camera or microphone">
        <div className="flex flex-col gap-4 pt-3">
          <SelectField label="Microphone" name="microphoneId" value={microphoneId ?? ""} onChange={(event) => onMicrophoneId(event.currentTarget.value || null)} options={options("microphone")} />
          <SelectField label="Camera" name="cameraId" value={cameraId ?? ""} onChange={(event) => onCameraId(event.currentTarget.value || null)} options={options("camera")} />
          <div>
            <Button size="sm" icon={<PiSpeakerHigh />} onClick={playTestSound}>Play a test sound</Button>
          </div>
        </div>
      </Disclosure>
    </section>
  );
}

/** Whether this browser can make calls at all, known only once it runs, so the server's HTML and the first render agree. */
function useBrowserSupport(): "unknown" | "ready" | "unsupported" {
  const [support, setSupport] = useState<"unknown" | "ready" | "unsupported">("unknown");
  useEffect(() => setSupport(mediaDevices() ? "ready" : "unsupported"), []);
  return support;
}

export default function PreJoin({ room, screen, joining, failure, conductNeeded, onJoin }: PreJoinProps) {
  const { meeting } = room;
  const canPrepare = screen.kind === "ready" || screen.kind === "too-early" || screen.kind === "waiting";
  const [microphoneId, setMicrophoneId] = useState<string | null>(null);
  const [cameraId, setCameraId] = useState<string | null>(null);
  const [choices, setChoices] = useState<Choices>({ microphoneOff: false, cameraOff: false, audioOnly: false });
  const [devices, setDevices] = useState<Record<DeviceKind, DeviceOption[]>>({ microphone: [], camera: [] });
  const browser = useBrowserSupport();
  const preparing = canPrepare && browser === "ready";
  const cameraWanted = !choices.cameraOff && !choices.audioOnly;

  const microphone = useDevice("microphone", microphoneId, preparing);
  const camera = useDevice("camera", cameraId, preparing && cameraWanted);
  const level = useLevel(microphone.stream);

  // Devices are named once one is allowed: read the list again then.
  useEffect(() => {
    const media = mediaDevices();
    if (media && (microphone.stream || camera.stream)) void listDevices(media).then(setDevices);
  }, [microphone.stream, camera.stream]);

  const notice = recordingNotice(meeting, room.cohortName, room.recordingRefused);
  const start = screen.kind === "ready" && screen.start;
  const unsupported = browser === "unsupported";

  function join() {
    // The preview's streams are released by their effects as this page goes; the room opens its own.
    onJoin({
      microphoneId, cameraId,
      microphoneOn: !choices.microphoneOff && !microphone.problem,
      cameraOn: cameraWanted && !camera.problem,
      audioOnly: choices.audioOnly,
    });
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-call-prejoin>
      <main className="mx-auto grid w-full max-w-6xl gap-8 px-4 py-6 sm:px-6 sm:py-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:gap-12">
        <div className="flex min-w-0 flex-col gap-5">
          <Heading room={room} />
          {failure && <Notice tone="danger" title={failure.title}>{failure.body}</Notice>}
          {conductNeeded && <ConductNotice href={room.conductHref} />}
          {screen.kind === "waiting" && <Notice title={waitingText(meeting.purpose).title}>{waitingText(meeting.purpose).body}</Notice>}
          {unsupported && <DeviceNotice kind="microphone" problem="unsupported" />}
          <Notice title={notice.title}>{notice.body}</Notice>
          <JoinChoices choices={choices} onChange={setChoices} disabled={!canPrepare} />
          <div className="flex flex-col items-start gap-2">
            <Button
              variant="primary" size="lg" icon={<PiVideoCamera />} onClick={join} data-call-join
              disabled={screen.kind !== "ready" || unsupported} loading={joining} aria-describedby="call-join-reason"
            >
              {joinLabel(meeting.purpose, start)}
            </Button>
            <p id="call-join-reason" className="m-0 max-w-prose text-sm text-ink-secondary">{joinReason(screen, meeting.purpose)}</p>
          </div>
          <p className="m-0 max-w-prose text-sm text-ink-muted">There are no live captions during calls yet. A recorded call gets a transcript afterwards.</p>
        </div>
        {preparing && (
          <DeviceCheck
            self={room.self} microphone={microphone} camera={camera} cameraWanted={cameraWanted} level={level} devices={devices}
            onCameraOff={() => setChoices({ ...choices, cameraOff: true })}
            microphoneId={microphoneId} cameraId={cameraId} onMicrophoneId={setMicrophoneId} onCameraId={setCameraId}
          />
        )}
      </main>
    </div>
  );
}
