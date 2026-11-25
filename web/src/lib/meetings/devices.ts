/**
 * The pre-join device check's browser calls (README.md beside this file, "The room"): no provider
 * SDK, only the browser's own camera and microphone. Every stream opened here is released by the
 * caller with `stopStream`, on Join, on leaving the page and when a choice changes.
 */

/** Why the browser gave no camera or microphone, each with its own words and a way to join without it. */
export type DeviceProblem = "blocked" | "missing" | "in-use" | "unsupported";

export type DeviceKind = "microphone" | "camera";

export interface DeviceOption {
  deviceId: string;
  label: string;
}

type Media = Pick<MediaDevices, "getUserMedia" | "enumerateDevices">;

/** The browser's media devices, or null where it can't make calls (an app's own browser, an insecure page). */
export function mediaDevices(): Media | null {
  const media = globalThis.navigator?.mediaDevices;
  return media && typeof media.getUserMedia === "function" ? media : null;
}

/** A failed getUserMedia, as the room says it. */
export function deviceProblem(error: unknown): DeviceProblem {
  const name = error instanceof Error || error instanceof DOMException ? error.name : "";
  switch (name) {
    case "NotAllowedError":
    case "SecurityError":
      return "blocked";
    case "NotFoundError":
    case "OverconstrainedError":
      return "missing";
    case "NotReadableError":
    case "AbortError":
      return "in-use";
    default:
      return "unsupported";
  }
}

/** What each problem says, and what the person can do instead. */
export function deviceProblemText(kind: DeviceKind, problem: DeviceProblem): { title: string; body: string } {
  const thing = kind === "camera" ? "camera" : "microphone";
  const without = kind === "camera" ? "You can join without it." : "You can join to listen, and turn it on once it works.";
  switch (problem) {
    case "blocked":
      return { title: `TTV can't use your ${thing}`, body: `Your browser blocked it. Allow it in this site's settings in your browser, then try again. ${without}` };
    case "missing":
      return { title: `No ${thing} found`, body: `Connect one and try again. ${without}` };
    case "in-use":
      return { title: `Your ${thing} is being used by another app`, body: `Close the other app and try again. ${without}` };
    case "unsupported":
      return { title: "This browser can't join calls", body: "Open TTV in Chrome or Safari. A link opened inside another app uses that app's own browser, where calls often don't work." };
  }
}

/** The microphones and cameras, named as the browser names them once it may (after permission). */
export async function listDevices(media: Media): Promise<Record<DeviceKind, DeviceOption[]>> {
  const devices = await media.enumerateDevices().catch(() => [] as MediaDeviceInfo[]);
  const of = (kind: MediaDeviceKind, fallback: string) => devices
    .filter((device) => device.kind === kind && device.deviceId)
    .map((device, index) => ({ deviceId: device.deviceId, label: device.label || `${fallback} ${index + 1}` }));
  return { microphone: of("audioinput", "Microphone"), camera: of("videoinput", "Camera") };
}

/** One device, as getUserMedia asks for it: the chosen one exactly, or the browser's default. */
export function constraint(deviceId: string | null): MediaTrackConstraints | true {
  return deviceId ? { deviceId: { exact: deviceId } } : true;
}

/** Opens one device for the preview. The caller stops the stream. */
export async function openDevice(media: Media, kind: DeviceKind, deviceId: string | null): Promise<MediaStream> {
  return media.getUserMedia(kind === "camera" ? { video: constraint(deviceId) } : { audio: constraint(deviceId) });
}

/** Releases every track of a stream, so the camera light goes out. */
export function stopStream(stream: MediaStream | null | undefined): void {
  for (const track of stream?.getTracks() ?? []) track.stop();
}

/** A short tone through the speakers, so the person can hear that sound works. */
export function playTestSound(): void {
  const AudioContextClass = globalThis.AudioContext;
  if (!AudioContextClass) return;
  const context = new AudioContextClass();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.frequency.value = 523.25;
  gain.gain.setValueAtTime(0.0001, context.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.2, context.currentTime + 0.05);
  gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.6);
  oscillator.connect(gain).connect(context.destination);
  oscillator.start();
  oscillator.stop(context.currentTime + 0.65);
  oscillator.addEventListener("ended", () => void context.close());
}

/** A level meter over a microphone track, 0–1, from the Web Audio API; null where the browser has none. */
export function audioMeter(track: MediaStreamTrack): { level(): number; close(): void } | null {
  const AudioContextClass = globalThis.AudioContext;
  if (!AudioContextClass) return null;
  const context = new AudioContextClass();
  const analyser = context.createAnalyser();
  analyser.fftSize = 512;
  context.createMediaStreamSource(new MediaStream([track])).connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  return {
    level() {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      return Math.min(1, Math.sqrt(sum / samples.length) * 4);
    },
    close() { void context.close(); },
  };
}
