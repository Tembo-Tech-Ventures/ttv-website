import { useRef, useState, type KeyboardEvent } from "react";
import {
  PiChatCircle, PiMicrophone, PiMicrophoneSlash, PiMonitorArrowUp, PiPhoneDisconnect, PiUsers, PiVideoCamera, PiVideoCameraSlash,
} from "react-icons/pi";
import { Button } from "@/components/platform/ui";

/**
 * The call's controls, one toolbar (UX-REVIEW §5): Tab reaches it once and the arrows, Home and End
 * move inside it. Each toggle says what pressing it will do ("Mute", "Unmute"), so it carries no
 * pressed state as well. Below 64rem the words are read but not shown, and every button stays a 44px
 * target, so six fit a 320px screen.
 */

export type Control = "microphone" | "camera" | "share" | "people" | "chat" | "leave";
const CONTROLS: readonly Control[] = ["microphone", "camera", "share", "people", "chat", "leave"];
export type Panel = "people" | "chat";

export interface RoomControlsProps {
  microphoneOn: boolean;
  cameraOn: boolean;
  sharing: boolean;
  audioOnly: boolean;
  panel: Panel | null;
  leaveLabel: string;
  leaving: boolean;
  onMicrophone: () => void;
  onCamera: () => void;
  onShare: () => void;
  onPanel: (panel: Panel) => void;
  onLeave: () => void;
}

/** The button that opens a panel, to give focus back to when it closes. */
export const controlFor = (panel: Panel) => document.querySelector<HTMLElement>(`#call-controls [data-control="${panel}"]`);

export default function RoomControls(props: RoomControlsProps) {
  const [active, setActive] = useState<Control>("microphone");
  const toolbar = useRef<HTMLDivElement>(null);
  const words = "max-lg:sr-only";

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = CONTROLS.indexOf(active);
    const next = { ArrowRight: index + 1, ArrowLeft: index - 1, Home: 0, End: CONTROLS.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    const control = CONTROLS[(next + CONTROLS.length) % CONTROLS.length]!;
    setActive(control);
    toolbar.current?.querySelector<HTMLElement>(`[data-control="${control}"]`)?.focus();
  }
  const stop = (control: Control) => ({ tabIndex: active === control ? 0 : -1, onFocus: () => setActive(control), "data-control": control });
  const panelButton = (panel: Panel) => ({ ...stop(panel), "aria-expanded": props.panel === panel, "aria-controls": "call-panel", onClick: () => props.onPanel(panel) });

  return (
    <div
      ref={toolbar} id="call-controls" role="toolbar" aria-label="Call controls" onKeyDown={onKeyDown} tabIndex={-1}
      className="flex min-w-0 items-center justify-center gap-1.5 border-t border-hairline px-2 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] [grid-area:controls] sm:gap-2"
    >
      <Button
        {...stop("microphone")} size="lg" variant={props.microphoneOn ? "quiet" : "danger"}
        icon={props.microphoneOn ? <PiMicrophone /> : <PiMicrophoneSlash />} onClick={props.onMicrophone}
      >
        <span className={words}>{props.microphoneOn ? "Mute" : "Unmute"}</span>
      </Button>
      <Button
        {...stop("camera")} size="lg" icon={props.cameraOn ? <PiVideoCamera /> : <PiVideoCameraSlash />} onClick={props.onCamera}
        disabled={props.audioOnly} aria-describedby={props.audioOnly ? "call-audio-only" : undefined}
      >
        <span className={words}>{props.cameraOn ? "Turn camera off" : "Turn camera on"}</span>
      </Button>
      {props.audioOnly && <span id="call-audio-only" hidden>Low data: your camera stays off in this call.</span>}
      <Button {...stop("share")} size="lg" icon={<PiMonitorArrowUp />} onClick={props.onShare}>
        <span className={words}>{props.sharing ? "Stop sharing" : "Share screen"}</span>
      </Button>
      <Button {...panelButton("people")} size="lg" icon={<PiUsers />}>
        <span className={words}>People</span>
      </Button>
      <Button {...panelButton("chat")} size="lg" icon={<PiChatCircle />}>
        <span className={words}>Chat</span>
      </Button>
      <Button {...stop("leave")} size="lg" variant="danger" icon={<PiPhoneDisconnect />} loading={props.leaving} onClick={props.onLeave}>
        <span className={words}>{props.leaveLabel}</span>
      </Button>
    </div>
  );
}
