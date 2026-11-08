import { PiArrowRight } from "react-icons/pi";
import { Avatar, Button, ButtonLink, Card, CountBadge, Notice, PersonMarker, RoleBadge, SpaceFile, TemboMark, TextReaction } from "@/components/platform/ui";
import { GUIDE_PEOPLE } from "./people";

/* The live examples beside each principle on the guide's first page. */

const { wanjiku, david, joseph, lucy } = GUIDE_PEOPLE;

export function WhereYouAre() {
  return (
    <SpaceFile
      label="Wanjiku's spaces"
      active="cohort"
      person={{ id: wanjiku.id, name: wanjiku.name }}
      tabs={[
        { space: "cohort", label: "Cohort", href: "#where-you-are" },
        { space: "community", label: "Community", href: "#where-you-are", count: 3 },
        { space: "profile", label: "Profile", href: "#where-you-are" },
      ]}
    >
      <div className="px-5 pt-6 pb-8 sm:px-7">
        <p className="m-0 text-lg font-bold text-ink-primary">Cohort 04</p>
        <p className="mt-1 mb-0 text-sm leading-relaxed text-ink-secondary">
          The sheet in front is the space you are in. Community waits behind, with three new things.
        </p>
      </div>
    </SpaceFile>
  );
}

export function PeopleFirst() {
  return (
    <div className="flex flex-col gap-5">
      <ul className="m-0 flex list-none flex-col gap-4 p-0">
        {[wanjiku, david, joseph].map((person) => (
          <li key={person.id} className="flex min-w-0 items-center gap-3">
            <Avatar id={person.id} name={person.name} decorative mentor={person.roleBadges.some((badge) => badge.kind === "MENTOR")} />
            <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-semibold whitespace-nowrap text-ink-primary">{person.name}</span>
              <span className="flex flex-wrap gap-1.5">
                {person.roleBadges.map((badge) => (
                  <RoleBadge key={badge.kind} badge={badge} />
                ))}
              </span>
            </span>
          </li>
        ))}
        <li className="flex min-w-0 items-center gap-3">
          <TemboMark decorative />
          <span className="font-semibold text-ink-primary">Tembo</span>
          <RoleBadge badge={{ kind: "AI", label: "AI" }} />
        </li>
      </ul>
      <p className="m-0 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-ink-secondary">
        <span className="inline-flex items-center gap-2">
          <PersonMarker kind="builder" /> Builders
        </span>
        <span className="inline-flex items-center gap-2">
          <PersonMarker kind="mentor" /> Mentors
        </span>
        <span className="inline-flex items-center gap-2">
          <PersonMarker kind="institution" /> Institutions
        </span>
      </p>
    </div>
  );
}

export function NextStep() {
  return (
    <Card as="article">
      <div className="flex items-center gap-3">
        <Avatar id={lucy.id} name={lucy.name} decorative />
        <p className="m-0 min-w-0 text-sm text-ink-secondary">
          <span className="font-semibold text-ink-primary">{lucy.name}</span> asked for 30 minutes on a portfolio review
        </p>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button variant="primary">Accept</Button>
        <Button>Suggest another mentor</Button>
        <Button variant="ghost">Not this month</Button>
      </div>
    </Card>
  );
}

export function WordsCarryMeaning() {
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-2">
        <TextReaction kind="useful" count={6} mine />
        <TextReaction kind="learned" count={2} />
        <TextReaction kind="thanks" count={1} />
      </div>
      <p className="m-0 flex items-center gap-2 text-sm text-ink-secondary">
        Mentor requests <CountBadge count={2} label="waiting for your answer" />
      </p>
      <Notice tone="success" announce="none">
        Request sent. David will see it in Mentoring.
      </Notice>
    </div>
  );
}

export function OnwardLinks({ links }: { links: ReadonlyArray<{ href: string; label: string }> }) {
  return (
    <div className="flex flex-wrap gap-2">
      {links.map((link, index) => (
        <ButtonLink key={link.href} href={link.href} variant={index === 0 ? "primary" : "quiet"} trailingIcon={index === 0 ? <PiArrowRight /> : undefined}>
          {link.label}
        </ButtonLink>
      ))}
    </div>
  );
}
