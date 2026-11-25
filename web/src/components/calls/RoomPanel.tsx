import { useEffect, type RefObject } from "react";
import { PiChatCircle, PiDotsThree, PiX } from "react-icons/pi";
import { Avatar, ButtonLink, Checkbox, IconButton, Menu, MenuItem, cx } from "@/components/platform/ui";
import type { MeetingPurpose } from "@/lib/platform/contracts";
import type { RoomParticipant } from "@/lib/meetings/room-client";
import { NOUN } from "@/lib/meetings/room-model";
import type { Panel } from "./RoomControls";

/**
 * The one side panel: People, or Chat (a link to the call's thread: the chat is the channel's, read
 * by people outside the call too, UX-REVIEW §3 row 07). Beside the stage from 64rem; on a phone it
 * covers the stage. It takes focus as it opens, and Escape closes it (never the call).
 */

/** The panel is drawn in the sheet's tone, so on a phone, where it covers the stage, it reads as the page. */
const SHEET: Record<MeetingPurpose, string> = { SESSION: "bg-sheet-cohort", CHECKIN: "bg-sheet-community", CALL: "bg-sheet-community", EVENT: "bg-sheet-community" };

export interface RoomPanelProps {
  panel: Panel;
  purpose: MeetingPurpose;
  participants: readonly RoomParticipant[];
  hosts: ReadonlySet<string>;
  isHost: boolean;
  chat: { href: string; place: string };
  sayArrivals: boolean;
  onSayArrivals: (on: boolean) => void;
  onClose: () => void;
  onMute: (person: RoomParticipant) => void;
  onStopShare: (person: RoomParticipant) => void;
  onRemove: (person: RoomParticipant) => void;
  /** The heading, which takes focus; a dialog opened from the panel gives focus back to it. */
  heading: RefObject<HTMLHeadingElement>;
}

function statusOf(person: RoomParticipant, host: boolean): string {
  return [host ? "Host" : null, person.microphoneOn ? null : "Muted", person.speaking ? "Speaking" : null, person.sharing ? "Sharing their screen" : null]
    .filter(Boolean).join(" · ");
}

function People({ participants, hosts, isHost, purpose, onMute, onStopShare, onRemove, sayArrivals, onSayArrivals }: RoomPanelProps) {
  const noun = NOUN[purpose];
  return (
    <>
      {isHost && (
        <p className="m-0 text-sm text-ink-secondary">
          You can mute people, stop their screen share and remove them. Someone you remove can't rejoin this {noun}.
        </p>
      )}
      <ul className="m-0 flex list-none flex-col p-0" data-call-people>
        {participants.map((person) => {
          const host = hosts.has(person.userId);
          const status = statusOf(person, host);
          return (
            <li key={person.userId} className="flex min-w-0 items-center gap-3 border-b border-hairline py-2 last:border-b-0" data-call-person={person.userId}>
              <Avatar id={person.userId} name={person.name} size="sm" decorative />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-semibold text-ink-primary">{person.self ? `${person.name} (you)` : person.name}</span>
                {status && <span className="text-sm text-ink-secondary">{status}</span>}
              </span>
              {isHost && !person.self && !host && (
                <Menu label={`Actions for ${person.name}`} icon={<PiDotsThree />} iconOnly align="end">
                  <MenuItem disabled={!person.microphoneOn} onSelect={() => onMute(person)}>{person.microphoneOn ? "Mute" : "Muted"}</MenuItem>
                  {person.sharing && <MenuItem onSelect={() => onStopShare(person)}>Stop their screen share</MenuItem>}
                  <MenuItem tone="danger" onSelect={() => onRemove(person)}>Remove from {noun}</MenuItem>
                </Menu>
              )}
            </li>
          );
        })}
      </ul>
      <Checkbox name="sayArrivals" label="Say when people join or leave" checked={sayArrivals} onChange={(event) => onSayArrivals(event.currentTarget.checked)} />
    </>
  );
}

export default function RoomPanel(props: RoomPanelProps) {
  const { panel, purpose, participants, chat, onClose, heading } = props;
  const noun = NOUN[purpose];
  useEffect(() => heading.current?.focus(), [panel, heading]);
  // Escape closes the panel when nothing inside it (an open menu) took the key, and never the call.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || document.querySelector("dialog[open]")) return;
      event.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <aside
      id="call-panel" aria-labelledby="call-panel-title" data-call-panel={panel}
      className={cx("z-10 flex min-h-0 min-w-0 flex-col gap-4 overflow-y-auto p-4 [grid-area:stage] lg:border-l lg:border-hairline lg:[grid-area:panel]", SHEET[purpose])}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 ref={heading} id="call-panel-title" tabIndex={-1} className="m-0 text-lg text-ink-primary">
          {panel === "people" ? `People · ${participants.length}` : "Chat"}
        </h2>
        <IconButton label={`Close ${panel === "people" ? "people" : "chat"}`} icon={<PiX />} variant="ghost" onClick={onClose} />
      </div>
      {panel === "people" ? <People {...props} /> : (
        <>
          <p className="m-0 text-sm text-ink-secondary">
            The chat for this {noun} is its thread in {chat.place}, so people who aren't in the call can read it too. It isn't in the recording.
          </p>
          <div>
            <ButtonLink href={chat.href} target="_blank" rel="noopener" icon={<PiChatCircle />}>
              Open the thread<span className="sr-only"> (opens in a new tab)</span>
            </ButtonLink>
          </div>
        </>
      )}
    </aside>
  );
}
