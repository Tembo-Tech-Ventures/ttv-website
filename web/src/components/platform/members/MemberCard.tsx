import { PiBriefcase, PiCheckCircle, PiGlobeSimple, PiStack } from "react-icons/pi";
import type { MemberCard as MemberCardData } from "@/lib/members/directory";
import { Avatar, Card, Chip, PersonMarker } from "@/components/platform/ui";
import { memberProfileHref } from "@/lib/members/links";
import { cardSkills, confirmedSummary, openToLabels, workSummary } from "./member-display";

interface MemberCardProps {
  member: MemberCardData;
}

/**
 * One member in the directory: who they are, what they work with and what they
 * have posted, on a card like the community's own, never a row in a table.
 * Rendered on the server with no island. The name is the link, and its press
 * area covers the card (`member-card__link`), so the whole card opens the
 * profile while a screen reader hears one link named for the person.
 *
 * Nothing on it ranks anyone: no score, no "top" marker, no count of views. The
 * counts say what is there to read, in words.
 */
export default function MemberCard({ member }: MemberCardProps) {
  // Namespaced, so no handle ("results", "you-title") can collide with an id the page itself uses.
  const headingId = `member-card-${member.handle}`;
  const { shown, more } = cardSkills(member.skills);
  const openTo = openToLabels(member);
  const confirmed = confirmedSummary(member.confirmedWorkCount);

  return (
    <Card as="li" aria-labelledby={headingId} className="member-card" data-member-card={member.handle}>
      <div className="flex items-start gap-4">
        {/* The handle is stable per person, so their initials keep one colour everywhere in the directory. */}
        <Avatar id={member.handle} name={member.displayName} src={member.avatarUrl ?? undefined} size="lg" decorative />
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="text-lg leading-snug font-bold break-words text-ink-primary">
            <a href={memberProfileHref(member)} className="member-card__link">{member.displayName}</a>
          </h3>
          {member.headline && <p className="mt-0.5 text-[0.9375rem] leading-snug break-words text-ink-secondary">{member.headline}</p>}
        </div>
      </div>

      {shown.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label={`Skills of ${member.displayName}`}>
          {shown.map((skill) => <li key={skill} className="flex min-w-0"><Chip>{skill}</Chip></li>)}
          {more > 0 && <li className="flex"><Chip>{`+${more} more`}</Chip></li>}
        </ul>
      )}

      {member.opportunityGoals && (
        <p className="member-card__goals text-[0.9375rem] leading-relaxed break-words text-ink-primary/90">{member.opportunityGoals}</p>
      )}

      <ul className="member-card__facts">
        <li><PiStack aria-hidden className="size-[1.125rem] shrink-0" /><span>{workSummary(member.postedWorkCount)}</span></li>
        {confirmed && <li><PiCheckCircle aria-hidden className="size-[1.125rem] shrink-0 text-success-ink" /><span>{confirmed}</span></li>}
        {member.completedCohorts.length > 0 && (
          <li>
            <PersonMarker kind="builder" className="mx-[0.1875rem]" />
            <span>Completed {member.completedCohorts.join(", ")}</span>
          </li>
        )}
        {openTo.length > 0 && <li><PiBriefcase aria-hidden className="size-[1.125rem] shrink-0" /><span>{openTo.join(" · ")}</span></li>}
        {member.onPublicSite && <li><PiGlobeSimple aria-hidden className="size-[1.125rem] shrink-0" /><span>On the public website</span></li>}
      </ul>
    </Card>
  );
}
