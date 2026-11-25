/**
 * DEV harness only (/dev/platform-embeds): every state of the embed cards,
 * at the width a message gives them. Some states (several mentors, none, no
 * evidence link, work that is no longer available) are carried by no fixture message, so
 * they are composed here from the fixtures.
 */
import { people, projects, sessionClip } from "@/lib/platform/fixtures";
import type { CallProposalCardView, MeetingCardView, MessageEmbedView } from "@/lib/platform/contracts";
import EmbedCard from "../EmbedCard";
import { served } from "./fixture-pages";
import "../channels.css";

const ledger = served(projects.chamaLedger);
const fare = served(projects.fareSplitter);


/** A fictional cohort session's card (in-app calls P9): Thursday 26 November 2026, 18:00 EAT, 45 minutes. */
const session: MeetingCardView = {
  type: "meeting", meetingId: "fixture-session", purpose: "SESSION", title: "Testing payment callbacks", state: "scheduled",
  scheduledStartAt: Date.parse("2026-11-26T15:00:00Z"), bookedMinutes: 45, openedAt: null, endedAt: null,
  recordingId: null, transcriptReady: false, notRecordedReason: null,
};

/** A fictional suggested call (in-app calls P10): three times from Wednesday 25 November 2026, 30 minutes. */
const proposal: CallProposalCardView = {
  type: "callProposal", proposalId: "fixture-proposal", purpose: "CALL", state: "open", proposedBy: people.david.id,
  times: [Date.parse("2026-11-25T08:00:00Z"), Date.parse("2026-11-25T11:00:00Z"), Date.parse("2026-11-26T08:00:00Z")],
  bookedMinutes: 30, askToRecord: false, work: null, call: null, moves: false,
};

export const EMBED_SCENES: readonly { key: string; title: string; embed: MessageEmbedView; compact?: boolean }[] = [
  { key: "earlier-revision", title: "A confirmation that covers an earlier revision", embed: ledger },
  { key: "this-revision", title: "Confirmed on the revision that was shared", embed: fare },
  {
    key: "several-mentors",
    title: "Two mentors, one on this revision",
    embed: {
      ...ledger,
      confirmations: [
        { mentorId: people.mercy.id, mentorName: people.mercy.name, version: 3 },
        { mentorId: people.david.id, mentorName: people.david.name, version: 2 },
      ],
    },
  },
  { key: "unconfirmed", title: "No confirmation yet, so none is mentioned", embed: { ...fare, confirmations: [] } },
  { key: "no-link", title: "A project with no evidence link: no way in to draw", embed: { ...ledger, link: null } },
  { key: "compact", title: "Compact, as a thread's first message", embed: ledger, compact: true },
  { key: "clip", title: "A session clip at its moment", embed: sessionClip },
  { key: "gone-project", title: "A project the reader can no longer open", embed: { type: "unavailable", was: "project" } },
  { key: "gone-clip", title: "A session clip the reader can no longer open", embed: { type: "unavailable", was: "sessionClip" } },
  { key: "session-scheduled", title: "A cohort session's card, before it starts", embed: session },
  { key: "session-live", title: "The same card while the session is live", embed: { ...session, state: "live", openedAt: session.scheduledStartAt - 120_000 } },
  { key: "session-processing", title: "Once it ends, with the recording on its way", embed: { ...session, state: "processing", openedAt: session.scheduledStartAt, endedAt: session.scheduledStartAt + 2_700_000 } },
  { key: "session-ready", title: "With its recording ready to watch", embed: { ...session, state: "ready", openedAt: session.scheduledStartAt, endedAt: session.scheduledStartAt + 2_700_000, recordingId: "fixture-recording", transcriptReady: true } },
  { key: "session-not-recorded", title: "A session that wasn't recorded, and why", embed: { ...session, state: "notRecorded", openedAt: session.scheduledStartAt, endedAt: session.scheduledStartAt + 2_700_000, notRecordedReason: "limit" } },
  { key: "call-suggested", title: "Times suggested for a call, as the other person sees them", embed: proposal },
  { key: "checkin-suggested", title: "A project check-in, asked to record", embed: { ...proposal, purpose: "CHECKIN", askToRecord: true, work: { title: "Bus fare splitter", version: 4 } } },
  { key: "call-booked", title: "Once a time is picked", embed: { ...proposal, state: "accepted", call: { meetingId: "fixture-proposal", state: "SCHEDULED", scheduledStartAt: proposal.times[1]! } } },
  { key: "call-not-now", title: "After Not now", embed: { ...proposal, state: "declined" } },
  { key: "call-expired", title: "When every time has passed", embed: { ...proposal, state: "expired" } },
];

export default function EmbedGallery() {
  return (
    <ul className="embed-gallery flex flex-col gap-10">
      {EMBED_SCENES.map((scene) => (
        <li key={scene.key} data-scene={scene.key}>
          <p className="text-sm font-semibold text-ink-secondary">{scene.title}</p>
          <EmbedCard embed={scene.embed} compact={scene.compact} />
        </li>
      ))}
    </ul>
  );
}
