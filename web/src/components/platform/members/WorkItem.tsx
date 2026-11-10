import { PiArrowUpRight, PiCheckCircle, PiClockCounterClockwise, PiGithubLogo, PiStar } from "react-icons/pi";
import type { WorkView } from "@/lib/members/directory";
import { evidenceHref } from "@/components/discovery/types";
import { Chip, linkClass } from "@/components/platform/ui";
import { formatCalendarDate } from "@/lib/display-date";

interface WorkItemProps {
  work: WorkView;
  /** On the author's own page, where an unconfirmed piece is worth saying, since they can ask for a review. */
  isOwn?: boolean;
}

const calendar = (date: string) => formatCalendarDate(new Date(`${date}T00:00:00Z`));
const fromSeconds = (seconds: number) => formatCalendarDate(new Date(seconds * 1000));
const KIND = { contribution: "Contribution", repo: "GitHub repository" } as const satisfies Record<WorkView["kind"], string>;

/**
 * One piece of posted work on a member's page: what it is, when, where it lives and what its author
 * wrote, then what each mentor checked. A repository is dated by its last push, and adds the facts
 * GitHub gave when it was added (language, stars, topics), with the day they were read in small print,
 * since they are a snapshot and not live.
 *
 * A confirmation belongs to the revision it reviewed. Once the work changes, it reads as an earlier
 * version's, never as a confirmation of the new text. No confirmation is not evidence against anyone,
 * so only the author is told, on their own page, where they can do something about it.
 */
export default function WorkItem({ work, isOwn = false }: WorkItemProps) {
  const headingId = `work-${work.id}`;
  const href = work.link ? evidenceHref(work.link) : null;
  const { repo } = work;
  const pushed = repo?.pushedAt ?? null;

  return (
    <li className="member-work" aria-labelledby={headingId} data-member-work={work.kind}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <Chip icon={work.kind === "repo" ? <PiGithubLogo className="size-3.5" /> : undefined}>{KIND[work.kind]}</Chip>
        {pushed === null ? (
          <time dateTime={work.occurredAt} className="text-[0.8125rem] text-ink-secondary">{calendar(work.occurredAt)}</time>
        ) : (
          <span className="text-[0.8125rem] text-ink-secondary">
            Last pushed <time dateTime={new Date(pushed * 1000).toISOString()}>{fromSeconds(pushed)}</time>
          </span>
        )}
      </div>
      <h3 id={headingId} className="mt-2 text-lg leading-snug break-words text-ink-primary">
        {href ? (
          <a href={href} target="_blank" rel="noopener noreferrer" className={linkClass("inline-flex max-w-full items-center gap-1 underline-offset-4 pointer-coarse:min-h-11")}>
            <span className="min-w-0 break-words">{work.title}</span>
            <span className="sr-only"> (opens in a new tab)</span>
            <PiArrowUpRight aria-hidden className="size-4 shrink-0" />
          </a>
        ) : work.title}
      </h3>
      {repo && (
        <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.8125rem] text-ink-secondary" data-member-repo>
          <span className="font-semibold break-all text-ink-primary">{repo.fullName}</span>
          {repo.language && <span>{repo.language}</span>}
          <span className="inline-flex items-center gap-1">
            <PiStar aria-hidden className="size-3.5" />
            {repo.stars === 1 ? "1 star" : `${repo.stars} stars`}
          </span>
        </p>
      )}
      {work.description && <p className="mt-3 max-w-prose text-[0.9375rem] leading-relaxed break-words whitespace-pre-line text-ink-primary/90">{work.description}</p>}
      {repo && repo.description && repo.description !== work.description && (
        <p className="mt-2 max-w-prose text-sm leading-relaxed break-words text-ink-secondary">{repo.description}</p>
      )}
      {repo && repo.topics.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2" aria-label={`Topics of ${repo.fullName}`}>
          {repo.topics.map((topic) => <li key={topic} className="flex min-w-0"><Chip>{topic}</Chip></li>)}
        </ul>
      )}
      {repo && <p className="mt-2 text-[0.8125rem] text-ink-muted">Stars and topics as GitHub showed them on {fromSeconds(repo.snapshotAt)}</p>}

      {work.confirmations.length === 0 ? (
        isOwn && <p className="mt-4 text-sm text-ink-secondary" data-member-confirmation="none">No mentor has confirmed this yet.</p>
      ) : (
        <ul className="mt-4 flex flex-col gap-3" aria-label={`Confirmations of ${work.title}`}>
          {work.confirmations.map((confirmation) => (
            <li key={confirmation.id} className="member-confirmation" data-member-confirmation={confirmation.isCurrentRevision ? "current" : "earlier"}>
              {confirmation.isCurrentRevision
                ? <PiCheckCircle aria-hidden className="mt-0.5 size-5 shrink-0 text-success-ink" />
                : <PiClockCounterClockwise aria-hidden className="mt-0.5 size-5 shrink-0 text-ink-secondary" />}
              <div className="min-w-0">
                <p className="font-semibold text-ink-primary">
                  {confirmation.isCurrentRevision ? "Confirmed by" : "An earlier version was confirmed by"} {confirmation.mentorName}
                </p>
                {confirmation.statement && <p className="mt-1 break-words whitespace-pre-line text-ink-primary/90">{confirmation.statement}</p>}
                <p className="mt-1 text-sm break-words text-ink-secondary">How they checked: {confirmation.method}</p>
                <p className="mt-1 text-[0.8125rem] text-ink-muted">
                  <time dateTime={new Date(confirmation.createdAt * 1000).toISOString()}>{fromSeconds(confirmation.createdAt)}</time>
                  {!confirmation.isCurrentRevision && ` · The work has changed since (now revision ${work.revision})`}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}
