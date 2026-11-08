import { PiArrowRight, PiPauseCircle } from "react-icons/pi";
import type { MentorAvailability, WorthAnotherLook } from "@/lib/platform/contracts";
import { WORTH_ANOTHER_LOOK_LIMIT } from "@/lib/platform/client/mentor-constants";
import { firstName } from "@/components/channels/channel-format";
import { ButtonLink, Card, Chip, FOCUS_RING, cx } from "@/components/platform/ui";
import { MENTOR_AVAILABILITY_PATH, monthName } from "./mentor-display";
import MentorSpots from "./MentorSpots";

/**
 * The Requests page's rail (screen 06): this month's spots, what the mentor is
 * open to, and "Worth another look". Rendered on the server with no island;
 * only the spots (`data-mentor-spots`) follow the answers given on the page,
 * so the queue's island draws `MentorSpots` there in place of the server's once
 * interactive.
 */
export default function MentorMonthRail({ availability, now, anotherLook }: {
  availability: MentorAvailability; now: number; anotherLook: WorthAnotherLook["items"];
}) {
  const { paused } = availability;
  return (
    <aside aria-labelledby="mentoring-month" className="flex flex-col gap-4" data-mentoring-rail>
      <h2 id="mentoring-month" className="text-lg text-ink-primary">Your {monthName(now)}</h2>
      <Card>
        <div data-mentor-spots>
          <MentorSpots availability={availability} used={availability.capacity.used} />
        </div>
      </Card>
      <Card>
        <h3 className="text-[0.9375rem] font-bold text-ink-primary">Open to</h3>
        {availability.areas.length > 0 ? (
          <ul className="mt-3 flex flex-wrap gap-2" aria-label="Areas you help with">
            {availability.areas.map(area => <li key={area} className="flex"><Chip tone="ring">{area}</Chip></li>)}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-ink-secondary">No areas listed yet.</p>
        )}
        <p className="mt-4 flex items-center justify-between gap-3 text-sm text-ink-secondary" data-requests-paused={paused}>
          <span className="inline-flex items-center gap-2"><PiPauseCircle aria-hidden className="size-[1.125rem]" />New requests</span>
          <Chip tone={paused ? "warning" : "neutral"}>{paused ? "Paused" : "Open"}</Chip>
        </p>
        <ButtonLink href={MENTOR_AVAILABILITY_PATH} trailingIcon={<PiArrowRight className="size-4" />} className="mt-4 w-fit">Edit availability</ButtonLink>
      </Card>
      {anotherLook.length > 0 && <AnotherLook items={anotherLook} />}
    </aside>
  );
}

/** How many "Worth another look" items the rail names before pointing at the Confirm page for the rest. */
const ANOTHER_LOOK_SHOWN = 3;

/**
 * "Worth another look" (screen 06, B-4.2): work this mentor confirmed whose owner has shared a newer
 * revision since, so the confirmation no longer covers what is shared now. Each links to the Confirm
 * page, where the newer revision waits. Shown only when there is something to look at.
 */
function AnotherLook({ items }: { items: WorthAnotherLook["items"] }) {
  const shown = items.slice(0, ANOTHER_LOOK_SHOWN);
  const more = items.length - shown.length;
  return (
    <Card as="section" aria-labelledby="another-look-title" data-another-look={items.length}>
      <h3 id="another-look-title" className="text-[0.9375rem] font-bold text-ink-primary">Worth another look</h3>
      <ul className="mt-3 flex flex-col gap-4">
        {shown.map(item => (
          <li key={item.journeyId} className="flex flex-col gap-2.5" data-another-look-item={item.journeyId}>
            <p className="text-sm leading-relaxed break-words text-ink-secondary">
              {firstName(item.owner.name)} shared revision {item.currentVersion} of {item.title}.
              Your confirmation covers revision {item.confirmedVersion}.
            </p>
            <ButtonLink href={item.href} className="w-fit" aria-label={`Review revision ${item.currentVersion} of ${item.title}`}>
              Review revision {item.currentVersion}
            </ButtonLink>
          </li>
        ))}
      </ul>
      {more > 0 && (
        <a href={shown[0]!.href} className={cx("mt-4 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-peach-ink underline-offset-4 hover:underline", FOCUS_RING)}>
          {more}{items.length >= WORTH_ANOTHER_LOOK_LIMIT ? "+" : ""} more on Confirm work <PiArrowRight aria-hidden className="size-4" />
        </a>
      )}
    </Card>
  );
}
