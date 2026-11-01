import { PiArrowRight, PiFolderSimple, PiPlayFill, PiVideoCamera } from "react-icons/pi";
import type { MessageEmbedView, ProjectEmbed, SessionClipEmbed, UnavailableEmbed } from "@/lib/platform/contracts";
import { FOCUS_RING } from "@/components/platform/ui/Button";
import Chip from "@/components/platform/ui/Chip";
import { cx } from "@/components/platform/ui/cx";
import PersonMarker from "@/components/platform/ui/PersonMarker";
import { clipTime } from "./channel-format";

/** Where a session clip plays: the cohort's session page, at the moment. */
export function clipHref(clip: Pick<SessionClipEmbed, "recordingId" | "startSeconds">): string {
  return `/dashboard/cohort/sessions/${encodeURIComponent(clip.recordingId)}?t=${Math.floor(clip.startSeconds)}`;
}

const isExternal = (href: string) => /^https?:/i.test(href);

/**
 * A mentor's confirmation, exactly as recorded: who, and which revision. When
 * the shared revision is newer, the card says the confirmation is of an
 * earlier one rather than lending it to work the mentor has not seen.
 */
function confirmationText(embed: ProjectEmbed, confirmation: ProjectEmbed["confirmations"][number]): string {
  const first = confirmation.mentorName.trim().split(/\s+/)[0];
  return confirmation.version === embed.version
    ? `Confirmed by ${first} on this revision`
    : `Confirmed by ${first} on revision ${confirmation.version}`;
}

function ProjectCard({ embed, compact }: { embed: ProjectEmbed; compact: boolean }) {
  const link = embed.link;
  const external = link !== null && isExternal(link);
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
      <div className="channel-embed__foot">
        {embed.confirmations.length > 0 && (
          <ul className="flex min-w-0 flex-col gap-1">
            {embed.confirmations.map((confirmation) => (
              <li key={`${confirmation.mentorId}-${confirmation.version}`} className="flex items-center gap-2">
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

/** Shared work this reader can no longer see: no title, no way in, nothing that was in it. */
function UnavailableCard({ embed }: { embed: UnavailableEmbed }) {
  const project = embed.was === "project";
  const Icon = project ? PiFolderSimple : PiVideoCamera;
  return (
    <div className="channel-embed" data-embed="unavailable">
      <p className="channel-embed__kind">
        <Icon aria-hidden="true" className="size-4 shrink-0" />
        {project ? "This project is no longer available" : "This session clip is no longer available"}
      </p>
    </div>
  );
}

/**
 * Work shared in a message. U-2.2 owns the full embed design; this is its
 * first form. `compact` (a thread's first message) keeps the title, the
 * confirmation and the way in, as on the phone prototype (m4).
 */
export default function EmbedCard({ embed, compact = false }: { embed: MessageEmbedView; compact?: boolean }) {
  if (embed.type === "unavailable") return <UnavailableCard embed={embed} />;
  return embed.type === "project" ? <ProjectCard embed={embed} compact={compact} /> : <ClipCard embed={embed} compact={compact} />;
}
