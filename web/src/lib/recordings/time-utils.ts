export interface TranscriptSegmentInput {
  startTime: number;
  endTime: number;
  text: string;
}

export function formatDuration(totalSeconds?: number | null) {
  if (!totalSeconds || totalSeconds < 0) return "--";

  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatTimestamp(totalSeconds: number) {
  return formatDuration(totalSeconds);
}

export function secondsToVttTimestamp(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const millis = Math.floor((totalSeconds % 1) * 1000);

  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function segmentsToVtt(segments: TranscriptSegmentInput[]) {
  const cues = segments.map((segment, index) => {
    return [
      String(index + 1),
      `${secondsToVttTimestamp(segment.startTime)} --> ${secondsToVttTimestamp(segment.endTime)}`,
      segment.text,
    ].join("\n");
  });

  return `WEBVTT\n\n${cues.join("\n\n")}`;
}

export function parseTimestampParam(value: string | null) {
  if (!value) return 0;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
}
