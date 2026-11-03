import { PiArrowRight, PiClock } from "react-icons/pi";
import type { MentorDirectoryItem } from "@/lib/platform/contracts";
import { firstName } from "@/components/channels/channel-format";
import { Avatar, Card, Chip } from "@/components/platform/ui";
import { BUTTON_VARIANTS, FOCUS_RING } from "@/components/platform/ui/Button";
import { cx } from "@/components/platform/ui/cx";
import { capacityView, FORMAT_LABELS, FULL_THIS_MONTH } from "./mentor-display";

interface Props {
  item: MentorDirectoryItem;
  now: number;
  /** This mentor's request drawer is open. */
  open: boolean;
  /** Where "Ask for time" goes without JavaScript: this page with `?ask=`, which renders the drawer as a form. */
  askHref: string;
  onAsk: (item: MentorDirectoryItem, from: HTMLElement) => void;
  /**
   * Where this person already stands with the mentor (QA4-12): a waiting request's status replaces "Ask for
   * time", as a second would be refused; an accepted one's conversation is offered beside it, since asking
   * again for another time is fine.
   */
  standing?: MentorCardStanding | null;
}

/** A request already waiting (its status, as Your requests says it), or an accepted one's conversation. */
export type MentorCardStanding = { kind: "waiting"; label: string } | { kind: "conversation"; href: string };

const ASK = cx(
  "inline-flex h-10 shrink-0 items-center justify-center rounded-xl px-4 text-sm font-semibold whitespace-nowrap",
  "transition-colors duration-150 motion-reduce:transition-none pointer-coarse:min-h-11", FOCUS_RING,
);

/**
 * One mentor in the directory (screen 05): who they are, what they help with
 * and how, and this month's room. A full mentor stays listed with the next
 * opening, and the card says "Full this month" where the button would be:
 * there is nothing to press, so nothing pretends to be pressable.
 */
export default function MentorCard({ item, now, open, askHref, onAsk, standing = null }: Props) {
  const { person } = item;
  const capacity = capacityView(item.capacity, now);
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
          // A link, so asking works without JavaScript; with it, the drawer opens as a dialog in place.
          <a
            href={askHref}
            // Several cards each have one, so the name says whose time it asks for (QA4-18).
            aria-label={`Ask for time with ${person.name}`}
            aria-haspopup="dialog"
            aria-expanded={open}
            onClick={event => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
              event.preventDefault();
              onAsk(item, event.currentTarget);
            }}
            // It opens a dialog, so Space works as it would on a button (Enter already follows the link's click).
            onKeyDown={event => {
              if (event.key !== " ") return;
              event.preventDefault();
              onAsk(item, event.currentTarget);
            }}
            className={cx(ASK, BUTTON_VARIANTS[open ? "primary" : "quiet"])}
            data-ask-mentor={person.id}
          >
            Ask for time
          </a>
        )}
      </div>
    </Card>
  );
}
