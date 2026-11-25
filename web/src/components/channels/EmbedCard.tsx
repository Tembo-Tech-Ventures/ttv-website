import { useEffect, useState } from "react";
import { PiArrowRight, PiFolderSimple, PiPlayFill, PiVideoCamera } from "react-icons/pi";
import type {
  MeetingCardState, MeetingCardView, MessageEmbedView, ProjectConfirmation, ProjectEmbed, SessionClipEmbed, UnavailableEmbed,
} from "@/lib/platform/contracts";
import { localTimeText } from "@/components/platform/sessions/local-time";
import { sessionDay, sessionHours } from "@/lib/meetings/session-times";
import { callPath, sessionCalendarPath } from "@/lib/platform/server/space-routes";
import type { ChipTone } from "@/components/platform/ui/tones";
import Chip from "@/components/platform/ui/Chip";
import { cx } from "@/components/platform/ui/cx";
import PersonMarker from "@/components/platform/ui/PersonMarker";
import { buttonClass, linkClass } from "@/components/platform/ui/recipes";
import { RAISED } from "@/components/platform/ui/tones";
import { clipTime, firstName } from "./channel-format";

/** Where a session clip plays: the cohort's session page, at the moment. */
export function clipHref(clip: Pick<SessionClipEmbed, "recordingId" | "startSeconds">): string {
  return `/dashboard/cohort/sessions/${encodeURIComponent(clip.recordingId)}?t=${Math.floor(clip.startSeconds)}`;
}

const isExternal = (href: string) => /^https?:/i.test(href);

/** A card's frame: the kit's raised surface and hairline. Work that is gone keeps the footprint as an outline. */
const CARD = "channel-embed rounded-[1.125rem] border border-hairline";
/** The way in: a small ghost button, at the card's foot. */
const GO = buttonClass({ variant: "ghost", size: "sm", className: "channel-embed__go" });

/**
 * The confirmations worth showing: one per mentor, the one on this revision
 * when there is one, otherwise their latest. This revision's come first.
 * No confirmation shows nothing: missing evidence is not evidence against.
 */
export function shownConfirmations(embed: ProjectEmbed): ProjectConfirmation[] {
  const rank = (confirmation: ProjectConfirmation) => (confirmation.version === embed.version ? Number.POSITIVE_INFINITY : confirmation.version);
  const best = new Map<string, ProjectConfirmation>();
  for (const confirmation of embed.confirmations) {
    const current = best.get(confirmation.mentorId);
    if (!current || rank(confirmation) > rank(current)) best.set(confirmation.mentorId, confirmation);
  }
  return [...best.values()].toSorted((a, b) => rank(b) - rank(a));
}

/**
 * A mentor's confirmation, exactly as recorded: who, and which revision. When
 * the shared revision is newer, the card says the confirmation is of an
 * earlier one rather than lending it to work the mentor has not seen.
 */
export function confirmationText(embed: ProjectEmbed, confirmation: ProjectConfirmation): string {
  const first = firstName(confirmation.mentorName);
  return confirmation.version === embed.version
    ? `Confirmed by ${first} on this revision`
    : `Confirmed by ${first} on revision ${confirmation.version}`;
}

function ProjectCard({ embed, compact }: { embed: ProjectEmbed; compact: boolean }) {
  // The project's own evidence link (https, screened with the message), or null when it has none
  // (B-2.4): then there is no way in to draw, since no TTV page is open to every reader yet.
  const link = embed.link;
  const external = link !== null && isExternal(link);
  const confirmations = shownConfirmations(embed);
  return (
    <div className={cx(CARD, RAISED)} data-embed="project">
      <p className="channel-embed__kind">
        <PiFolderSimple aria-hidden="true" className="size-4 shrink-0" />
        Project · revision {embed.version}
      </p>
      <p className="channel-embed__title">
        {/* The work on its owner's member page, where every confirmation and the rest of their work are. */}
        {embed.memberHref
          ? <a href={embed.memberHref} className={linkClass("pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center")}>{embed.title}</a>
          : embed.title}
      </p>
      {!compact && embed.summary && <p className="channel-embed__summary">{embed.summary}</p>}
      {!compact && embed.skills.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5" aria-label="Skills">
          {embed.skills.map((skill) => (
            <li key={skill} className="flex min-w-0">
              <Chip>{skill}</Chip>
            </li>
          ))}
        </ul>
      )}
      {(confirmations.length > 0 || link !== null) && (
        <div className="channel-embed__foot">
          {confirmations.length > 0 && (
            <ul className="flex min-w-0 flex-col gap-1" aria-label="Mentor confirmations">
              {confirmations.map((confirmation) => (
                <li
                  key={confirmation.mentorId}
                  className="flex items-center gap-2"
                  data-confirmation={confirmation.version === embed.version ? "this-revision" : "other-revision"}
                >
                  <PersonMarker kind="mentor" />
                  {confirmationText(embed, confirmation)}
                </li>
              ))}
            </ul>
          )}
          {link !== null && (
            <a
              href={link}
              {...(external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
              className={GO}
            >
              Open<span className="sr-only"> {embed.title}{external ? " (opens in a new tab)" : ""}</span>
              <PiArrowRight aria-hidden="true" className="size-3.5" />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

function ClipCard({ embed, compact }: { embed: SessionClipEmbed; compact: boolean }) {
  const at = clipTime(embed.startSeconds);
  return (
    <div className={cx(CARD, RAISED, "channel-embed--clip")} data-embed="sessionClip">
      {/* A larger target for pointers; keyboards and screen readers use "Watch from" below, the same link. */}
      <a href={clipHref(embed)} tabIndex={-1} aria-hidden="true" className="channel-clip__poster">
        <span className="channel-clip__play">
          <PiPlayFill className="size-4" />
        </span>
        <span className="channel-clip__at">{at}</span>
      </a>
      <div className="min-w-0">
        <p className="channel-embed__kind">
          <PiVideoCamera aria-hidden="true" className="size-4 shrink-0" />
          Session clip · {clipTime(embed.durationSeconds)}
        </p>
        <p className="channel-embed__title">{embed.title}</p>
        {!compact && <blockquote className="channel-clip__quote">“{embed.quote}”</blockquote>}
        <div className="channel-embed__foot">
          <a href={clipHref(embed)} className={GO}>
            Watch from {at}
            <span className="sr-only">, {embed.title}</span>
            <PiArrowRight aria-hidden="true" className="size-3.5" />
          </a>
        </div>
      </div>
    </div>
  );
}

/** Work that was shared here and this reader can no longer open. It says so, and nothing about what it was. */
function UnavailableCard({ embed }: { embed: UnavailableEmbed }) {
  const project = embed.was === "project";
  const Icon = project ? PiFolderSimple : PiVideoCamera;
  return (
    <div className={cx(CARD, "channel-embed--gone border-dashed")} data-embed="unavailable" data-embed-was={embed.was}>
      <p className="channel-embed__kind">
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        {project ? "Project" : "Session clip"}
      </p>
      <p className="channel-embed__title">{project ? "This project is no longer available" : "This session clip is no longer available"}</p>
      <p className="channel-embed__summary">It may have been removed, or it isn't shared with you.</p>
    </div>
  );
}

/** Where a session's recording plays, and where Tembo answers about the cohort's sessions. */
export const sessionHref = (recordingId: string) => `/dashboard/cohort/sessions/${encodeURIComponent(recordingId)}`;
export const ASK_TEMBO_HREF = "/dashboard/cohort/ask";

/** The chip each state of a session's card wears: words, never colour alone. */
const SESSION_CHIP: Record<MeetingCardState, { label: string; tone: ChipTone }> = {
  scheduled: { label: "Scheduled", tone: "neutral" },
  live: { label: "Live now", tone: "peach" },
  processing: { label: "Ended", tone: "neutral" },
  ready: { label: "Recording ready", tone: "success" },
  notRecorded: { label: "Not recorded", tone: "neutral" },
  failed: { label: "Recording failed", tone: "danger" },
  ended: { label: "Ended", tone: "neutral" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

/** What the card says under the time, for each state (voice.md: plain, and what to do next). */
export function sessionCardLine(card: MeetingCardView): string {
  switch (card.state) {
    case "scheduled": return "Add it to your calendar to get a reminder from it. Join opens here when a host starts it.";
    case "live": return "Recording from start to end. The chat is this message's thread.";
    case "processing": return "The recording will be on this card when it's ready.";
    case "ready": return card.transcriptReady ? "Watch it with its transcript, or ask Tembo about it." : "Watch it now. Its transcript is still being made.";
    case "notRecorded": return card.notRecordedReason === "limit" ? "This session wasn't recorded: TTV had reached its recording limit for the month."
      : card.notRecordedReason === "short" ? "This session wasn't recorded: it was too short to keep." : "This session wasn't recorded.";
    case "failed": return "The recording failed, so there's nothing to watch. Ask your instructor if you need this session.";
    case "ended": return "This session has ended. Its recording isn't available to the cohort.";
    case "cancelled": return "This session was cancelled.";
  }
}

/**
 * A cohort session's card (in-app calls P9): its time in Nairobi time, with the reader's own where it
 * differs, then what each state offers: "Add to calendar" before it starts, "Join session" while it is
 * live (in its own tab, so the call outlives the channel), and "Watch recording" and "Ask Tembo" once
 * the recording is ready. The server works the state out on every read and moves the message when it
 * changes, so an open page's poll redraws it without a reload.
 */
function SessionCard({ card, compact }: { card: MeetingCardView; compact: boolean }) {
  // The reader's own time is written once mounted, so the server's HTML and the first render agree.
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => setLocal(localTimeText(card.scheduledStartAt, card.bookedMinutes)), [card.scheduledStartAt, card.bookedMinutes]);
  const chip = SESSION_CHIP[card.state];
  const named = <span className="sr-only">: {card.title}</span>;
  return (
    <div className={cx(CARD, RAISED)} data-embed="meeting" data-card-state={card.state}>
      <p className="channel-embed__kind">
        <PiVideoCamera aria-hidden="true" className="size-4 shrink-0" />
        Cohort session
        <Chip tone={chip.tone}>{chip.label}</Chip>
      </p>
      <p className="channel-embed__title">{card.title}</p>
      <p className="channel-embed__summary">
        <time dateTime={new Date(card.scheduledStartAt).toISOString()}>
          {`${sessionDay(card.scheduledStartAt, Date.now())}, ${sessionHours(card.scheduledStartAt, card.bookedMinutes)}`}
        </time>
        {local ? ` · ${local}` : ""}
      </p>
      {!compact && <p className="channel-embed__summary">{sessionCardLine(card)}</p>}
      {(card.state === "scheduled" || card.state === "live" || card.state === "ready") && (
        <div className="channel-embed__foot">
          {card.state === "scheduled" && (
            <a href={sessionCalendarPath(card.meetingId)} download className={GO} data-add-to-calendar>
              Add to calendar{named}
            </a>
          )}
          {card.state === "live" && (
            <a href={callPath(card.meetingId)} target="_blank" rel="noopener" className={GO} data-call-link>
              Join session<span className="sr-only">: {card.title} (opens in a new tab)</span>
              <PiArrowRight aria-hidden="true" className="size-3.5" />
            </a>
          )}
          {card.state === "ready" && card.recordingId !== null && (
            <>
              {card.transcriptReady && <a href={ASK_TEMBO_HREF} className={buttonClass({ variant: "ghost", size: "sm" })}>Ask Tembo</a>}
              <a href={sessionHref(card.recordingId)} className={GO} data-watch-recording>
                Watch recording{named}
                <PiArrowRight aria-hidden="true" className="size-3.5" />
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Work shared in a message: a project at the revision that was shared, with
 * the mentor confirmations it carries and which revision each covers; a
 * session clip at its moment, with what was said; or, when the reader can no
 * longer open it, a quiet card that says so; or a cohort session's card. `compact` (a thread's first
 * message) keeps the title, the confirmation and the way in, as on the phone
 * prototype (m4).
 */
export default function EmbedCard({ embed, compact = false }: { embed: MessageEmbedView; compact?: boolean }) {
  if (embed.type === "unavailable") return <UnavailableCard embed={embed} />;
  if (embed.type === "meeting") return <SessionCard card={embed} compact={compact} />;
  return embed.type === "project" ? <ProjectCard embed={embed} compact={compact} /> : <ClipCard embed={embed} compact={compact} />;
}
