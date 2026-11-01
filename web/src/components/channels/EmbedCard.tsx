import { PiArrowRight, PiFolderSimple, PiPlayFill, PiVideoCamera } from "react-icons/pi";
import type { MessageEmbedView, ProjectConfirmation, ProjectEmbed, SessionClipEmbed, UnavailableEmbed } from "@/lib/platform/contracts";
import { FOCUS_RING } from "@/components/platform/ui/Button";
import Chip from "@/components/platform/ui/Chip";
import { cx } from "@/components/platform/ui/cx";
import PersonMarker from "@/components/platform/ui/PersonMarker";
import { clipTime, firstName } from "./channel-format";

/** Where a session clip plays: the cohort's session page, at the moment. */
export function clipHref(clip: Pick<SessionClipEmbed, "recordingId" | "startSeconds">): string {
  return `/dashboard/cohort/sessions/${encodeURIComponent(clip.recordingId)}?t=${Math.floor(clip.startSeconds)}`;
}

const isExternal = (href: string) => /^https?:/i.test(href);

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
    <div className="channel-embed" data-embed="project">
      <p className="channel-embed__kind">
        <PiFolderSimple aria-hidden="true" className="size-4 shrink-0" />
        Project · revision {embed.version}
      </p>
      <p className="channel-embed__title">{embed.title}</p>
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
              className={cx("channel-embed__go", FOCUS_RING)}
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
    <div className="channel-embed channel-embed--clip" data-embed="sessionClip">
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
          <a href={clipHref(embed)} className={cx("channel-embed__go", FOCUS_RING)}>
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
    <div className="channel-embed channel-embed--gone" data-embed="unavailable" data-embed-was={embed.was}>
      <p className="channel-embed__kind">
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        {project ? "Project" : "Session clip"}
      </p>
      <p className="channel-embed__title">{project ? "This project is no longer available" : "This session clip is no longer available"}</p>
      <p className="channel-embed__summary">It may have been removed, or it isn't shared with you.</p>
    </div>
  );
}

/**
 * Work shared in a message: a project at the revision that was shared, with
 * the mentor confirmations it carries and which revision each covers; a
 * session clip at its moment, with what was said; or, when the reader can no
 * longer open it, a quiet card that says so. `compact` (a thread's first
 * message) keeps the title, the confirmation and the way in, as on the phone
 * prototype (m4).
 */
export default function EmbedCard({ embed, compact = false }: { embed: MessageEmbedView; compact?: boolean }) {
  if (embed.type === "unavailable") return <UnavailableCard embed={embed} />;
  return embed.type === "project" ? <ProjectCard embed={embed} compact={compact} /> : <ClipCard embed={embed} compact={compact} />;
}
