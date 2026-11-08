import type { KeyboardEvent, MouseEvent } from "react";
import { PiArrowRight, PiClock } from "react-icons/pi";
import type { MentorDirectoryItem } from "@/lib/platform/contracts";
import { shownStatus, type MentorRequestsState } from "@/lib/platform/client/mentor-requests";
import { firstName } from "@/components/channels/channel-format";
import { Avatar, ButtonLink, Card, Chip, FOCUS_RING, cx } from "@/components/platform/ui";
import { capacityView, conversationHref, FORMAT_LABELS, FULL_THIS_MONTH, requesterStatus } from "./mentor-display";

/** A request already waiting (its status, as Your requests says it), or an accepted one's conversation. */
export type MentorCardStanding = { kind: "waiting"; label: string } | { kind: "conversation"; href: string };

/**
 * Where this person already stands with each mentor, from their own requests (QA4-12): a request still waiting
 * (or being checked) shows its status where "Ask for time" would be, since a second one would be refused, and
 * an accepted one leads to its conversation. Newest first, so the latest request to a mentor decides.
 */
export function standings(state: Pick<MentorRequestsState, "items" | "pending">): ReadonlyMap<string, MentorCardStanding> {
  const found = new Map<string, MentorCardStanding>();
  for (const request of state.items) {
    const status = shownStatus(state, request);
    const id = request.mentor.id;
    if (status === "PENDING") {
      found.set(id, { kind: "waiting", label: requesterStatus(request, status).label });
    } else if (status === "ACCEPTED" && request.channelId && !found.has(id)) {
      found.set(id, { kind: "conversation", href: conversationHref(request.channelId) });
    }
  }
  return found;
}

/** Whether two standings say the same, so a store change that moves no card renders nothing. */
export function sameStandings(a: ReadonlyMap<string, MentorCardStanding>, b: ReadonlyMap<string, MentorCardStanding>): boolean {
  if (a.size !== b.size) return false;
  for (const [id, value] of a) {
    const other = b.get(id);
    if (!other || JSON.stringify(other) !== JSON.stringify(value)) return false;
  }
  return true;
}

interface CardProps {
  item: MentorDirectoryItem;
  now: number;
  /** Where "Ask for time" goes: this page with `?ask=`, which renders the drawer as a form. */
  askHref: string;
  /** Where this person stands with the mentor as the page read it. */
  standing?: MentorCardStanding | null;
}

/**
 * One mentor in the directory (screen 05): who they are, what they help with
 * and how, and this month's room. A full mentor stays listed with the next
 * opening, and the card says "Full this month" where the button would be:
 * there is nothing to press, so nothing pretends to be pressable.
 *
 * Rendered on the server. Its lower part (`data-mentor-live`) is what changes
 * with the person's own requests; once the page is interactive, the
 * directory's island renders `MentorCardLive` there in its place.
 */
export default function MentorCard({ item, now, askHref, standing = null }: CardProps) {
  const { person } = item;
  const headingId = `mentor-${person.id}`;

  return (
    <Card as="li" aria-labelledby={headingId} className="mentor-card flex flex-col gap-4" data-mentor-card={person.id}>
      <div className="flex items-center gap-4">
        <Avatar id={person.id} name={person.name} src={person.avatarUrl ?? undefined} size="lg" mentor decorative />
        <div className="min-w-0">
          <h3 id={headingId} className="text-lg leading-snug font-bold break-words text-ink-primary">{person.name}</h3>
          <p className="text-[0.9375rem] leading-snug break-words text-ink-secondary">{item.headline}</p>
        </div>
      </div>
      {item.bio && <p className="text-[0.9375rem] leading-relaxed break-words text-ink-primary/90">{item.bio}</p>}
      <dl className="flex flex-col gap-2.5">
        {item.areas.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <dt className="sr-only">Helps with</dt>
            {item.areas.map(area => <dd key={area} className="contents"><Chip>{area}</Chip></dd>)}
          </div>
        )}
        <div className="text-[0.8125rem] leading-snug text-ink-secondary">
          <dt className="inline">Offers </dt>
          <dd className="inline">{item.formats.map(format => FORMAT_LABELS[format]).join(" · ")}</dd>
        </div>
      </dl>
      {/* `contents`, so the live part's rows stay rows of the card. */}
      <div className="contents" data-mentor-live={person.id}>
        <MentorCardLive item={item} now={now} askHref={askHref} standing={standing} />
      </div>
    </Card>
  );
}

interface LiveProps extends CardProps {
  /** This mentor's request drawer is open. */
  open?: boolean;
  /** With JavaScript, "Ask for time" opens the drawer as a dialog in place; without, it is a plain link. */
  onAsk?: (item: MentorDirectoryItem, from: HTMLElement) => void;
}

/**
 * The part of a card that follows the person's requests (QA4-12): an accepted request's conversation,
 * offered beside "Ask for time" since asking again for another time is fine, and this month's room
 * with either "Ask for time" or, while a request waits, its status, as a second would be refused.
 */
export function MentorCardLive({ item, now, askHref, standing = null, open = false, onAsk }: LiveProps) {
  const { person } = item;
  const capacity = capacityView(item.capacity, now);
  // With JavaScript the link opens a dialog: it says so, and opens it in place.
  const opens = onAsk && {
    "aria-haspopup": "dialog" as const,
    "aria-expanded": open,
    onClick: (event: MouseEvent<HTMLAnchorElement>) => {
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
      event.preventDefault();
      onAsk(item, event.currentTarget);
    },
    // Space works as it would on a button (Enter already follows the link's click).
    onKeyDown: (event: KeyboardEvent<HTMLAnchorElement>) => {
      if (event.key !== " ") return;
      event.preventDefault();
      onAsk(item, event.currentTarget);
    },
  };
  return (
    <>
      {standing?.kind === "conversation" && (
        <a
          href={standing.href}
          className={cx("inline-flex min-h-11 w-fit items-center gap-1.5 text-sm font-semibold text-peach-ink underline-offset-4 hover:underline", FOCUS_RING)}
          data-mentor-standing="conversation"
        >
          Open your conversation with {firstName(person.name)} <PiArrowRight aria-hidden className="size-4" />
        </a>
      )}
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-hairline pt-4">
        <p className="flex min-w-0 items-center gap-2 text-sm text-ink-secondary" data-mentor-capacity>
          <PiClock aria-hidden className="size-[1.125rem] shrink-0" />
          <span>{capacity.text}</span>
        </p>
        {standing?.kind === "waiting" ? (
          // A second request would be refused while one waits; Your requests above holds it, with Withdraw.
          <p tabIndex={-1} className={cx("rounded-sm text-sm font-semibold text-ink-primary", FOCUS_RING)} data-mentor-standing="waiting">{standing.label}</p>
        ) : !capacity.open ? (
          <p className="text-sm font-semibold text-ink-primary" data-mentor-full>{FULL_THIS_MONTH}</p>
        ) : (
          // A link, so asking works without JavaScript. Quiet on every card: the drawer's Send is the page's one primary.
          <ButtonLink
            href={askHref}
            variant="quiet"
            // Several cards each have one, so the name says whose time it asks for (QA4-18).
            aria-label={`Ask for time with ${person.name}`}
            {...opens}
            data-ask-mentor={person.id}
          >
            Ask for time
          </ButtonLink>
        )}
      </div>
    </>
  );
}
