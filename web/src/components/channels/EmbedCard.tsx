import { useEffect, useState, type ReactNode } from "react";
import { PiArrowRight, PiCalendarBlank, PiFolderSimple, PiPlayFill, PiVideoCamera } from "react-icons/pi";
import type {
  CallProposalCardState, CallProposalCardView, MeetingCardState, MeetingCardView, MessageEmbedView, ProjectConfirmation, ProjectEmbed,
  SessionClipEmbed, UnavailableEmbed,
} from "@/lib/platform/contracts";
import { localTimeText } from "@/components/platform/sessions/local-time";
import { pickableTimes } from "@/lib/meetings/proposal-card";
import { lengthLabel, sessionDay, sessionHours } from "@/lib/meetings/session-times";
import {
  bookedCallCalendarPath, bookedCallPath, callPath, proposalPath, sessionCalendarPath, suggestCallPath,
} from "@/lib/platform/server/space-routes";
import type { ChipTone } from "@/components/platform/ui/tones";
import Button from "@/components/platform/ui/Button";
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
  if (card.purpose === "CALL" || card.purpose === "CHECKIN") return callCardLine(card);
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

/** A call between two people's card, under its time: it is recorded only if both say yes on the day (slice P11). */
export function callCardLine(card: MeetingCardView): string {
  const what = card.purpose === "CHECKIN" ? "check-in" : "call";
  switch (card.state) {
    case "scheduled": return card.purpose === "CHECKIN"
      ? "Add it to your calendar. Either of you can open it a few minutes before. It ends at 30 minutes."
      : "Add it to your calendar. Either of you can open it a few minutes before.";
    case "live": return `The ${what} is open. Join it from here.`;
    case "processing": return "The recording will be on this card when it's ready.";
    case "ready": return "Its recording is ready for the two of you.";
    case "notRecorded": return `This ${what} wasn't recorded.`;
    case "failed": return "The recording failed, so there's nothing to watch.";
    case "ended": return `This ${what} has ended.`;
    case "cancelled": return `This ${what} was cancelled.`;
  }
}

/** What a call's card is called: a cohort session, or a call between two people. */
const CARD_KIND = { SESSION: "Cohort session", CALL: "Call", CHECKIN: "Project check-in", EVENT: "Event" } as const;

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
  // A call between two people has its own page and calendar file (proposals.ts); a session's are under Sessions.
  const twoPeople = card.purpose === "CALL" || card.purpose === "CHECKIN";
  return (
    <div className={cx(CARD, RAISED)} data-embed="meeting" data-card-state={card.state}>
      <p className="channel-embed__kind">
        <PiVideoCamera aria-hidden="true" className="size-4 shrink-0" />
        {CARD_KIND[card.purpose]}
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
            <a href={twoPeople ? bookedCallCalendarPath(card.meetingId) : sessionCalendarPath(card.meetingId)} download className={GO} data-add-to-calendar>
              Add to calendar{named}
            </a>
          )}
          {card.state === "scheduled" && twoPeople && (
            <a href={bookedCallPath(card.meetingId)} className={GO} data-booked-call>
              Change or cancel{named}
            </a>
          )}
          {card.state === "live" && (
            <a href={callPath(card.meetingId)} target="_blank" rel="noopener" className={GO} data-call-link>
              {twoPeople ? "Join call" : "Join session"}<span className="sr-only">: {card.title} (opens in a new tab)</span>
              <PiArrowRight aria-hidden="true" className="size-3.5" />
            </a>
          )}
          {card.state === "ready" && card.recordingId !== null && !twoPeople && (
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

/** The chip each state of a suggested call's card wears: words, never colour alone. */
const PROPOSAL_CHIP: Record<CallProposalCardState, { label: string; tone: ChipTone }> = {
  open: { label: "Waiting for an answer", tone: "peach" },
  accepted: { label: "Booked", tone: "success" },
  countered: { label: "Other times suggested", tone: "neutral" },
  declined: { label: "Not now", tone: "neutral" },
  withdrawn: { label: "Withdrawn", tone: "neutral" },
  expired: { label: "Times passed", tone: "neutral" },
  cancelled: { label: "Call cancelled", tone: "neutral" },
};

/** A suggested time in Nairobi time, with the reader's own written once mounted (so the server's HTML and the first render agree). */
function ProposedTime({ at, minutes }: { at: number; minutes: number }) {
  const [local, setLocal] = useState<string | null>(null);
  useEffect(() => setLocal(localTimeText(at, minutes)), [at, minutes]);
  return (
    <>
      <time dateTime={new Date(at).toISOString()}>{`${sessionDay(at, Date.now())}, ${sessionHours(at, minutes)}`}</time>
      {local ? ` · ${local}` : ""}
    </>
  );
}

/** What a suggested call's card says, for its state and for who is reading it (voice.md: plain, and what to do next). */
export function proposalCardLine(card: CallProposalCardView, mine: boolean): string {
  const what = card.purpose === "CHECKIN" ? "check-in" : "call";
  switch (card.state) {
    case "open":
      if (mine) return "Waiting for an answer. You can withdraw it until a time is picked.";
      return card.moves ? "Pick one of these new times, suggest others, or say Not now. Saying Not now keeps the booked time."
        : "Pick a time, suggest others, or say Not now. Saying Not now tells nobody else anything.";
    case "accepted": return card.moves ? `The ${what} moved to this time.` : `The ${what} is booked.`;
    case "countered": return "Other times were suggested in a new message.";
    case "declined": return card.moves ? "Not now. The booked time stays as it is." : "Not now. Either of you can suggest a call again.";
    case "withdrawn": return "This suggestion was withdrawn.";
    case "expired": return "These times have passed.";
    case "cancelled": return "The call was cancelled, so these times closed.";
  }
}

/**
 * A suggested call's card in a direct conversation (in-app calls P10): the times offered, in Nairobi
 * time with the reader's own, and what the reader can do with it. The other person picks a time, suggests
 * others or says "Not now"; the person who suggested it can withdraw it. Each is a plain form posting to
 * the suggestion's own page, so it works without JavaScript and comes back to the conversation. A
 * suggestion whose times have passed offers only new times. The state is the server's on each read.
 */
function ProposalCard({ card, compact, viewerId, channelId }: { card: CallProposalCardView; compact: boolean; viewerId: string | null; channelId: string | null }) {
  const mine = viewerId !== null && card.proposedBy === viewerId;
  // A time that has started is never offered, even before the server says the suggestion expired.
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => setNow(Date.now()), []);
  const open = card.state === "open" && (now === null || pickableTimes(card.times, now).length > 0);
  const state = card.state === "open" && !open ? "expired" : card.state;
  const chip = PROPOSAL_CHIP[state];
  const pickable = open && !mine ? (now === null ? card.times : pickableTimes(card.times, now)) : [];
  return (
    <div className={cx(CARD, RAISED)} data-embed="callProposal" data-card-state={state}>
      <p className="channel-embed__kind">
        <PiCalendarBlank aria-hidden="true" className="size-4 shrink-0" />
        {card.moves ? "New times for your call" : card.purpose === "CHECKIN" ? "Project check-in" : "Call"}
        <Chip tone={chip.tone}>{chip.label}</Chip>
      </p>
      {card.work && <p className="channel-embed__title">{`${card.work.title}, revision ${card.work.version}`}</p>}
      {card.moves && card.call && card.state !== "accepted" && (
        <p className="channel-embed__summary">Booked now: <ProposedTime at={card.call.scheduledStartAt} minutes={card.bookedMinutes} /></p>
      )}
      <ProposalTimes card={card} pickable={pickable} />
      {!compact && <p className="channel-embed__summary">{proposalSummary({ ...card, state }, mine)}</p>}
      <ProposalActions card={card} state={state} open={open} mine={mine} channelId={channelId} />
    </div>
  );
}

/** The card's words under the times: how long, whether recording was asked, and where it stands for this reader. */
function proposalSummary(card: CallProposalCardView, mine: boolean): string {
  const length = card.purpose === "CHECKIN" ? "Up to 30 minutes." : `${lengthLabel(card.bookedMinutes)}.`;
  const record = card.askToRecord ? " Asked to record: you'll both be asked on the day, and it's recorded only if you both say yes." : "";
  return `${length}${record} ${proposalCardLine(card, mine)}`;
}

/** The times: one button each to pick from, for the other person while it is open; otherwise the times as words (the booked one once picked). */
function ProposalTimes({ card, pickable }: { card: CallProposalCardView; pickable: readonly number[] }) {
  if (pickable.length === 0) {
    const shown = card.state === "accepted" && card.call ? [card.call.scheduledStartAt] : card.times;
    return (
      <ul className="channel-embed__summary m-0 flex list-none flex-col gap-1 p-0">
        {shown.map((at) => <li key={at}><ProposedTime at={at} minutes={card.bookedMinutes} /></li>)}
      </ul>
    );
  }
  return (
    <ul className="channel-embed__summary m-0 flex list-none flex-col gap-2 p-0" aria-label="Pick a time">
      {pickable.map((at) => (
        <li key={at}>
          <AnswerForm card={card} answer="pick" at={at}>
            <Button type="submit" variant="ghost" size="sm" className="h-auto w-full justify-start py-1.5" data-pick-time={at}>
              {/* The time wraps, left aligned, inside the kit's single-line button. */}
              <span className="min-w-0 text-left whitespace-normal"><span className="sr-only">Pick </span><ProposedTime at={at} minutes={card.bookedMinutes} /></span>
            </Button>
          </AnswerForm>
        </li>
      ))}
    </ul>
  );
}

/** One answer as a plain form posting to the suggestion's own page, which comes back to the conversation. */
function AnswerForm({ card, answer, at, children }: { card: CallProposalCardView; answer: "pick" | "notNow" | "withdraw"; at?: number; children: ReactNode }) {
  return (
    <form method="post" action={proposalPath(card.proposalId)} className="m-0">
      <input type="hidden" name="answer" value={answer} />
      {at !== undefined && <input type="hidden" name="at" value={String(at)} />}
      <input type="hidden" name="from" value="conversation" />
      {children}
    </form>
  );
}

/** What the reader can do besides picking: other times or Not now, Withdraw, new times once it's over, or the booked call. */
function ProposalActions({ card, state, open, mine, channelId }: {
  card: CallProposalCardView; state: CallProposalCardState; open: boolean; mine: boolean; channelId: string | null;
}) {
  const over = state === "expired" || state === "declined" || state === "withdrawn";
  return (
    <div className="channel-embed__foot">
      {open && !mine && channelId && (
        <>
          <a href={suggestCallPath(channelId, { instead: card.proposalId })} className={GO} data-suggest-other>Suggest other times</a>
          <AnswerForm card={card} answer="notNow"><Button type="submit" variant="quiet" size="sm" data-not-now>Not now</Button></AnswerForm>
        </>
      )}
      {open && mine && <AnswerForm card={card} answer="withdraw"><Button type="submit" variant="quiet" size="sm" data-withdraw>Withdraw</Button></AnswerForm>}
      {over && channelId && !card.moves && <a href={suggestCallPath(channelId)} className={GO} data-suggest-new>Suggest new times</a>}
      {card.state === "accepted" && card.call && (
        <a href={bookedCallPath(card.call.meetingId)} className={GO} data-booked-call>
          See the call<PiArrowRight aria-hidden="true" className="size-3.5" />
        </a>
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
export default function EmbedCard({ embed, compact = false, viewerId = null, channelId = null }: {
  embed: MessageEmbedView; compact?: boolean;
  /** Who is reading, and the conversation, for a suggested call's card: who answers it and where new times are suggested. */
  viewerId?: string | null; channelId?: string | null;
}) {
  if (embed.type === "unavailable") return <UnavailableCard embed={embed} />;
  if (embed.type === "meeting") return <SessionCard card={embed} compact={compact} />;
  if (embed.type === "callProposal") return <ProposalCard card={embed} compact={compact} viewerId={viewerId} channelId={channelId} />;
  return embed.type === "project" ? <ProjectCard embed={embed} compact={compact} /> : <ClipCard embed={embed} compact={compact} />;
}
