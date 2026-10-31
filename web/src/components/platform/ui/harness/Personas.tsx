import type { ReactNode } from "react";
import { PiBellSimple, PiCheck, PiMagnifyingGlass, PiPaperPlaneRight, PiSparkle } from "react-icons/pi";
import {
  Avatar,
  Button,
  Card,
  Chip,
  IconButton,
  Pill,
  RoleBadge,
  SpaceFile,
  TemboMark,
  TextReaction,
  type SpaceTabItem,
} from "..";
import { PEOPLE, TEMBO } from "./people";

/*
 * The assembled "tab row + sheet" for three people, using only primitives.
 * The sheet contents are sketches of the screens these primitives will build
 * (prototype screens 02, 06 and 08), enough to judge the primitives in
 * context, not the screens themselves.
 */

function Tools({ attention }: { attention: number }) {
  return (
    <>
      <IconButton label="Search everything" icon={<PiMagnifyingGlass size={18} />} variant="ghost" />
      <IconButton
        label="Attention"
        icon={<PiBellSimple size={18} />}
        badge={attention}
        badgeLabel="waiting"
        variant="quiet"
      />
    </>
  );
}

function Message({
  who,
  badge,
  time,
  children,
}: {
  who: { id: string; name: string };
  badge?: ReactNode;
  time: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-3">
      <Avatar id={who.id} name={who.name} size="md" decorative className="mt-0.5" />
      <div className="min-w-0 flex-1">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-ink-muted">
          <span className="text-[0.9375rem] font-bold text-ink-primary">{who.name}</span>
          {badge}
          <span>{time}</span>
        </p>
        <div className="mt-1 text-[0.9375rem] leading-relaxed text-ink-primary">{children}</div>
      </div>
    </li>
  );
}

function SheetHeader({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="border-b border-hairline px-5 pt-5 pb-4 sm:px-7">
      <h4 className="text-lg font-bold text-ink-primary">{title}</h4>
      <p className="mt-0.5 text-sm text-ink-muted">{sub}</p>
    </div>
  );
}

function Student() {
  const tabs: SpaceTabItem[] = [
    { space: "cohort", label: "Cohort", href: "#student-cohort", count: 2 },
    { space: "community", label: "Community", href: "#student-community", unread: true },
    { space: "profile", label: "Profile", href: "#student-profile" },
  ];
  return (
    <SpaceFile tabs={tabs} active="cohort" person={PEOPLE.wanjiku} end={<Tools attention={4} />}>
      <SheetHeader title="# cohort-04" sub="Cohort 04 · 23 people" />
      <ul className="space-y-6 px-5 py-6 sm:px-7">
        <Message who={PEOPLE.faith} badge={<RoleBadge badge={PEOPLE.faith.roleBadges[0]} />} time="08:30">
          Session 9 is up. Retries start around 34 minutes.
        </Message>
        <Message who={PEOPLE.wanjiku} badge={<RoleBadge badge={PEOPLE.wanjiku.roleBadges[0]} />} time="08:55">
          <span className="rounded bg-primary/10 px-1 font-semibold text-peach-ink">@tembo</span> why return
          200 on a duplicate?
        </Message>
        <li className="flex gap-3">
          <TemboMark size="md" decorative className="mt-0.5" />
          <div className="min-w-0 flex-1">
            <p className="flex items-center gap-2 text-[0.8125rem] text-ink-muted">
              <span className="text-[0.9375rem] font-bold text-ink-primary">Tembo</span>
              <RoleBadge badge={TEMBO.roleBadges[0]} />
              <span>08:55</span>
            </p>
            <Card className="mt-2">
              <p className="text-[0.9375rem] leading-relaxed text-ink-primary">
                The 200 tells the provider &ldquo;I have this one&rdquo;, so it stops retrying. The duplicate
                already succeeded the first time.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Chip tone="peach">Session 9 · 34:12</Chip>
              </div>
              <p className="mt-3 text-[0.8125rem] text-ink-muted">Sees: Cohort 04 recordings · You: 6 of 10 today</p>
            </Card>
            <div className="mt-2 flex flex-wrap gap-2">
              <TextReaction kind="useful" count={6} mine />
              <TextReaction kind="learned" count={4} />
            </div>
          </div>
        </li>
      </ul>
      <div className="flex items-center gap-2 border-t border-hairline px-5 py-4 sm:px-7">
        <Button variant="ghost" size="sm" icon={<PiSparkle size={16} />}>
          Ask Tembo
        </Button>
        <IconButton label="Send" icon={<PiPaperPlaneRight size={18} />} variant="primary" className="ml-auto" />
      </div>
    </SpaceFile>
  );
}

function Mentor() {
  const tabs: SpaceTabItem[] = [
    { space: "community", label: "Community", href: "#mentor-community" },
    { space: "mentoring", label: "Mentoring", href: "#mentor-mentoring", count: 2 },
    { space: "profile", label: "Profile", href: "#mentor-profile" },
  ];
  return (
    <SpaceFile tabs={tabs} active="mentoring" person={PEOPLE.david} end={<Tools attention={2} />}>
      <SheetHeader title="Requests" sub="You have room for 2 more this month." />
      <div className="flex flex-wrap gap-1 px-5 pt-4 sm:px-7">
        <Pill pressed count={2}>
          Needs a decision
        </Pill>
        <Pill pressed={false} count={5}>
          Decided
        </Pill>
      </div>
      <div className="px-5 py-5 sm:px-7">
        <Card as="article" aria-labelledby="mentor-request-title">
          <div className="flex items-start gap-3">
            <Avatar id={PEOPLE.wanjiku.id} name={PEOPLE.wanjiku.name} size="lg" decorative />
            <div className="min-w-0 flex-1">
              <h5 id="mentor-request-title" className="text-base font-bold text-ink-primary">
                Wanjiku Mwangi
              </h5>
              <div className="mt-1 flex flex-wrap gap-1.5">
                <RoleBadge badge={PEOPLE.wanjiku.roleBadges[0]} />
              </div>
            </div>
          </div>
          <p className="mt-3 text-[0.9375rem] leading-relaxed text-ink-secondary">
            Could you look at how my receipt parser handles duplicate callbacks? Revision 3 adds a replay test.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Chip>TypeScript</Chip>
            <Chip>Cloudflare Workers</Chip>
            <Chip>D1</Chip>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="primary" size="sm" icon={<PiCheck size={16} />}>
              Accept
            </Button>
            <Button variant="quiet" size="sm">
              Suggest another mentor
            </Button>
            <Button variant="ghost" size="sm">
              Not this month
            </Button>
          </div>
        </Card>
      </div>
    </SpaceFile>
  );
}

function Staff() {
  const tabs: SpaceTabItem[] = [
    { space: "cohort", label: "Cohort", href: "#staff-cohort" },
    { space: "community", label: "Community", href: "#staff-community" },
    { space: "mentoring", label: "Mentoring", href: "#staff-mentoring" },
    { space: "admin", label: "Admin", href: "#staff-admin", count: 3 },
    { space: "profile", label: "Profile", href: "#staff-profile" },
  ];
  return (
    <SpaceFile tabs={tabs} active="admin" person={PEOPLE.amina} end={<Tools attention={3} />}>
      <SheetHeader title="Moderation" sub="Held for a person to look at. Nothing here is hidden yet." />
      <div className="px-5 py-5 sm:px-7">
        <Card as="article" aria-labelledby="staff-flag-title">
          <h5 id="staff-flag-title" className="flex flex-wrap items-center gap-2 text-sm font-bold text-ink-primary">
            Contact details in #introductions
            <Chip tone="peach">Flagged</Chip>
          </h5>
          <ul className="mt-3">
            <Message who={PEOPLE.kevin} badge={<RoleBadge badge={PEOPLE.kevin.roleBadges[0]} />} time="Yesterday">
              Happy to pair on this, message me on my number and we can set it up.
            </Message>
          </ul>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="quiet" size="sm">
              Keep
            </Button>
            <Button variant="danger" size="sm">
              Hide
            </Button>
          </div>
        </Card>
      </div>
    </SpaceFile>
  );
}

const PERSONAS = [
  { key: "student", who: PEOPLE.wanjiku, role: "Student, Cohort 04", Body: Student },
  { key: "mentor", who: PEOPLE.david, role: "Mentor", Body: Mentor },
  { key: "staff", who: PEOPLE.amina, role: "Staff", Body: Staff },
] as const;

export default function Personas() {
  return (
    <div className="space-y-14">
      {PERSONAS.map(({ key, who, role, Body }) => (
        <figure key={key} data-persona={key} aria-labelledby={`persona-${key}`}>
          <figcaption className="mb-5 flex items-center gap-3">
            <Avatar id={who.id} name={who.name} size="lg" decorative />
            <div>
              <h3 id={`persona-${key}`} className="text-lg font-bold text-ink-primary">
                {who.name}
              </h3>
              <p className="text-sm text-ink-muted">{role}</p>
            </div>
          </figcaption>
          <Body />
        </figure>
      ))}
    </div>
  );
}
