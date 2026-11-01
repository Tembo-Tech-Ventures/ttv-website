/**
 * "How we talk to each other": the code of conduct people see the first time
 * they open a channel, and can read again at any time (CONDUCT_PATH).
 *
 * Every line describes something channels actually do (owner decisions
 * 2026-10-31: contact details are flagged for a person, never hidden; no
 * WhatsApp bridge; institutions may read community channels). Change the
 * words only with the coordinator, and when a change means people should read
 * it again, bump CONDUCT_VERSION in lib/channels/conduct.ts: everyone who
 * agreed to an older version is asked again.
 */
import { formatMomentDate } from "@/lib/display-date";

export const CONDUCT_TITLE = "How we talk to each other";

export const CONDUCT_LEAD = "Channels are where TTV builders, alumni, mentors and the team talk through the work. These habits keep them worth opening.";

export interface ConductHabit {
  /** Stable, for anchors and tests. */
  key: "share" | "critique" | "contact" | "here" | "audience" | "limits";
  title: string;
  body: string;
}

export const CONDUCT_HABITS: readonly ConductHabit[] = [
  {
    key: "share",
    title: "Share the work, ask the question.",
    body: "Half-finished is welcome. If you’re stuck, say what you’ve tried: someone here has usually hit the same wall.",
  },
  {
    key: "critique",
    title: "Critique the work, not the person.",
    body: "Be specific about what you’d change and why, and assume good intent.",
  },
  {
    key: "contact",
    title: "Keep contact details out of messages.",
    body: "Phone numbers, email addresses and WhatsApp or Telegram links are flagged for a moderator to look at. The message stays up until a person decides.",
  },
  {
    key: "here",
    title: "Keep the conversation here.",
    body: "These channels have no WhatsApp group or bridge, so conversations stay inside TTV.",
  },
  {
    key: "audience",
    title: "Know who’s reading.",
    body: "Community channels are open to everyone signed in to TTV, including people from organisations with approved access. Cohort channels are for that cohort, its instructors, TAs and mentors, and TTV staff.",
  },
  {
    key: "limits",
    title: "No harassment, hate or spam.",
    body: "Anyone can report a message. Mentors and staff can hide one that crosses the line, with a reason; if it’s yours, you’ll be told and can ask for a review.",
  },
];

/** The one action on the first visit. It records that you read this; it grants nothing. */
export const CONDUCT_ACCEPT = "I’ll keep to this";

/** Shown instead of the action to an agent acting for someone: agreeing is the person's own act. */
export const CONDUCT_AGENT_NOTE = "An agent acting for someone can read these habits, but only the person can agree to them.";

/** Shown above the habits on a channel the first time, so the step explains itself. */
export const CONDUCT_FIRST_VISIT = "Before your first channel, a minute on how this place works.";

/** "You agreed to this on 1 Nov 2026.", the day in Nairobi time as members read every moment. */
export function agreedOn(acknowledgedAt: number): string {
  return `You agreed to this on ${formatMomentDate(new Date(acknowledgedAt))}.`;
}
