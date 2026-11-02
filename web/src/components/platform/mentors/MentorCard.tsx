import { PiClock } from "react-icons/pi";
import type { MentorDirectoryItem } from "@/lib/platform/contracts";
import { Avatar, Button, Card, Chip } from "@/components/platform/ui";
import { capacityView, FORMAT_LABELS, FULL_THIS_MONTH } from "./mentor-display";

interface Props {
  item: MentorDirectoryItem;
  now: number;
  /** This mentor's request drawer is open. */
  open: boolean;
  /** The viewer may ask mentors for time (a member account); otherwise the card only reads. */
  canAsk: boolean;
  onAsk: (item: MentorDirectoryItem, from: HTMLButtonElement) => void;
}

/**
 * One mentor in the directory (screen 05): who they are, what they help with
 * and how, and this month's room. A full mentor stays listed with the next
 * opening, and the card says "Full this month" where the button would be:
 * there is nothing to press, so nothing pretends to be pressable.
 */
export default function MentorCard({ item, now, open, canAsk, onAsk }: Props) {
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
        <div className="flex flex-wrap items-baseline gap-x-1.5 text-[0.8125rem] text-ink-secondary">
          <dt>Offers</dt>
          <dd>{item.formats.map(format => FORMAT_LABELS[format]).join(" · ")}</dd>
        </div>
      </dl>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-t border-hairline pt-4">
        <p className="flex min-w-0 items-center gap-2 text-sm text-ink-secondary" data-mentor-capacity>
          <PiClock aria-hidden className="size-[1.125rem] shrink-0" />
          <span>{capacity.text}</span>
        </p>
        {!capacity.open ? (
          <p className="text-sm font-semibold text-ink-primary" data-mentor-full>{FULL_THIS_MONTH}</p>
        ) : canAsk && (
          <Button
            variant={open ? "primary" : "quiet"}
            aria-haspopup="dialog"
            aria-expanded={open}
            aria-describedby={headingId}
            onClick={event => onAsk(item, event.currentTarget)}
            data-ask-mentor={person.id}
          >
            Ask for time
          </Button>
        )}
      </div>
    </Card>
  );
}
