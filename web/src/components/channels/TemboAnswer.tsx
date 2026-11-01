import { PiChatsCircle, PiFolderSimple, PiVideoCamera } from "react-icons/pi";
import type { Citation, Message, TemboScope } from "@/lib/platform/contracts";

const ICON = "size-3.5 shrink-0 text-peach-ink";

export function citationIcon(citation: Citation) {
  switch (citation.type) {
    case "project":
      return <PiFolderSimple aria-hidden="true" className={ICON} />;
    case "sessionClip":
      return <PiVideoCamera aria-hidden="true" className={ICON} />;
    case "message":
      return <PiChatsCircle aria-hidden="true" className={ICON} />;
  }
}

/** What Tembo could read for this answer, from the scope the server stored with it. */
export const TEMBO_SEES: Record<TemboScope, string> = {
  COHORT: "this cohort's recordings and this channel",
  COMMUNITY: "this thread and public projects",
  DIRECT: "only this conversation",
};

/**
 * The line under a Tembo answer saying what it could see. U-3.1 adds the
 * allowance and "Helpful / Not quite" here.
 */
export function TemboAnswerFoot({ message }: { message: Message }) {
  if (message.temboScope === null) return null;
  return <p className="channel-tembo__foot">Sees: {TEMBO_SEES[message.temboScope]}</p>;
}
