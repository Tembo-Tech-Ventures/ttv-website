import { useEffect, useRef } from "react";
import { PiMicrophoneSlash, PiMonitorArrowUp, PiWaveform } from "react-icons/pi";
import { Avatar, cx } from "@/components/platform/ui";
import type { RoomParticipant } from "@/lib/meetings/room-client";

/** A track drawn in a `<video>`, attached once mounted. Never plays sound: audio is the provider's. */
export function TrackVideo({ track, label, mirror = false, fit = "cover" }: { track: MediaStreamTrack; label: string; mirror?: boolean; fit?: "cover" | "contain" }) {
  const video = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    if (video.current) video.current.srcObject = new MediaStream([track]);
  }, [track]);
  return (
    <video
      ref={video} autoPlay playsInline muted aria-label={label}
      className={cx("h-full w-full", fit === "cover" ? "object-cover" : "object-contain", mirror && "-scale-x-100")}
    />
  );
}

/**
 * One person in the call: their camera, or their face or initials. Their name, and words for what
 * colour shows (muted, speaking, sharing), so colour is never the only signal (UX-REVIEW §5).
 */
export default function RoomTile({ person, host, audioOnly, compact = false }: { person: RoomParticipant; host: boolean; audioOnly: boolean; compact?: boolean }) {
  const video = person.video && !audioOnly ? person.video : null;
  const name = person.self ? `${person.name} (you)` : person.name;
  return (
    <li
      data-call-tile={person.userId}
      data-speaking={person.speaking || undefined}
      className={cx(
        "relative flex aspect-video min-w-0 items-center justify-center overflow-hidden rounded-xl bg-ink-primary/6 outline-offset-0",
        person.speaking && "outline-2 outline-peach-ink",
        compact ? "w-40 shrink-0" : "w-full",
      )}
    >
      {video
        ? <TrackVideo track={video} label={`${name}'s camera`} mirror={person.self} />
        : <Avatar id={person.userId} name={person.name} size={compact ? "md" : "lg"} decorative />}
      <p className="absolute inset-x-1.5 bottom-1.5 m-0 flex min-w-0 items-center gap-1.5 text-xs">
        <span className="flex min-w-0 items-center gap-1.5 rounded-md bg-ground/80 px-2 py-1 text-ink-primary">
          {!person.microphoneOn && <PiMicrophoneSlash aria-hidden="true" className="shrink-0" />}
          {person.speaking && <PiWaveform aria-hidden="true" className="shrink-0 text-peach-ink" />}
          {person.sharing && <PiMonitorArrowUp aria-hidden="true" className="shrink-0" />}
          <span className="truncate">{name}</span>
          <span className="sr-only">
            {[host ? "host" : null, person.microphoneOn ? null : "muted", person.speaking ? "speaking" : null, person.sharing ? "sharing their screen" : null]
              .filter(Boolean).map((word) => `, ${word}`).join("")}
          </span>
          {host && <span aria-hidden="true" className="shrink-0 text-ink-secondary">· Host</span>}
        </span>
      </p>
    </li>
  );
}
