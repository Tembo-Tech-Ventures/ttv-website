import { PiLockSimple } from "react-icons/pi";
import type { Channel } from "@/lib/platform/contracts";
import { postingFor } from "./channel-format";

const COPY = {
  staff: "Only the TTV team posts here. You can read everything they share.",
  archived: "This channel is archived. You can still read it.",
  closed: "You can read this channel, but not post in it.",
} as const;

/** Where the composer would be, when this person cannot post: why not. */
export function PostingNote({ channel }: { channel: Channel }) {
  const posting = postingFor(channel);
  if (posting === "open") return null;
  return (
    <p className="channel-posting-note" data-posting={posting}>
      <PiLockSimple aria-hidden="true" className="size-4 shrink-0" />
      {COPY[posting]}
    </p>
  );
}
