import { PiArrowUpRight, PiBriefcase, PiGlobeSimple } from "react-icons/pi";
import type { MemberProfileView } from "@/lib/members/directory";
import { firstName } from "@/components/channels/channel-format";
import { Avatar, BackLink, ButtonLink, Chip, EmptyState, Notice, PageHeader, PersonMarker, linkClass } from "@/components/platform/ui";
import WorkItem from "./WorkItem";
import { confirmedSummary, MEMBERS_PATH, openToLabels, postWorkHref, profileEditorHref, workSummary } from "./member-display";

interface MemberProfileProps {
  member: MemberProfileView;
}

/**
 * A member's page in the app: who they are, what they work with and are looking
 * for, and everything they have posted, each piece with what mentors checked.
 * What everyone signed in sees; the person's own page is the same, with the way
 * to their editor. The public website is linked only when they are on it.
 */
export default function MemberProfile({ member }: MemberProfileProps) {
  return (
    <article aria-labelledby="member-name" className="flex max-w-4xl flex-col gap-10" data-member-profile={member.handle}>
      <div className="flex flex-col gap-6">
        <BackLink href={MEMBERS_PATH} className="w-fit">Members</BackLink>
        <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
          <Avatar id={member.handle} name={member.displayName} src={member.avatarUrl ?? undefined} size="xl" decorative className="sm:mt-2" />
          <PageHeader
            className="min-w-0 flex-1"
            title={member.displayName}
            titleId="member-name"
            action={member.isOwn ? <ButtonLink href={profileEditorHref()} variant="primary">Edit your profile</ButtonLink> : undefined}
          >
            {member.headline || undefined}
          </PageHeader>
        </div>
        {member.isOwn && (
          <Notice tone="info" title="This is your page as others see it">
            Everyone signed in to TTV can see your profile and everything you post.
            {member.onPublicSite ? " It's also on the public website, where anyone can see it." : ""}
          </Notice>
        )}
        <Standing member={member} />
      </div>
      <About member={member} />
      <Work member={member} />
    </article>
  );
}

/** Cohorts completed, what they are open to, and their page on the public website when there is one. */
function Standing({ member }: MemberProfileProps) {
  const first = firstName(member.displayName);
  const openTo = openToLabels(member);
  const chips = member.completedCohorts.length > 0 || openTo.length > 0;
  if (!chips && !member.publicUrl) return null;
  return (
    <div className="flex flex-col gap-3">
      {chips && (
        <ul className="flex flex-wrap gap-2" aria-label={`About ${first}`}>
          {member.completedCohorts.map((cohort) => (
            <li key={cohort} className="flex min-w-0"><Chip icon={<PersonMarker kind="builder" />}>{`Completed ${cohort}`}</Chip></li>
          ))}
          {openTo.map((label) => <li key={label} className="flex min-w-0"><Chip icon={<PiBriefcase className="size-3.5" />}>{label}</Chip></li>)}
        </ul>
      )}
      {member.publicUrl && (
        <a href={member.publicUrl} className={linkClass("inline-flex min-h-11 w-fit items-center gap-1.5")} data-member-public>
          <PiGlobeSimple aria-hidden className="size-4 shrink-0" />
          {member.isOwn ? "Your page on the public website" : `${first}'s page on the public website`}
          <PiArrowUpRight aria-hidden className="size-4 shrink-0" />
        </a>
      )}
    </div>
  );
}

/** Their own words, about them and what they are looking for, beside their skills. */
function About({ member }: MemberProfileProps) {
  const prose = [
    { id: "member-about", title: "About", text: member.bio },
    { id: "member-goals", title: "Looking for", text: member.opportunityGoals },
  ].filter((section) => section.text);
  if (prose.length === 0 && member.skills.length === 0) return null;
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
      <div className="flex min-w-0 flex-col gap-8">
        {prose.map((section) => (
          <section key={section.id} aria-labelledby={section.id} className="flex flex-col gap-2">
            <h2 id={section.id} className="text-xl text-ink-primary">{section.title}</h2>
            <p className="max-w-prose text-base leading-relaxed break-words whitespace-pre-line text-ink-primary/90">{section.text}</p>
          </section>
        ))}
      </div>
      {member.skills.length > 0 && (
        <section aria-labelledby="member-skills" className="flex min-w-0 flex-col gap-3">
          <h2 id="member-skills" className="text-xl text-ink-primary">Skills</h2>
          <ul className="flex flex-wrap gap-2">
            {member.skills.map((skill) => <li key={skill} className="flex min-w-0"><Chip>{skill}</Chip></li>)}
          </ul>
        </section>
      )}
    </div>
  );
}

/** Everything they have posted, or what fills the place when nothing is yet. */
function Work({ member }: MemberProfileProps) {
  const first = firstName(member.displayName);
  return (
    <section aria-labelledby="member-work" className="flex flex-col gap-5" data-member-work-list>
      <div className="flex flex-col gap-1 border-b border-hairline pb-4">
        <h2 id="member-work" className="text-xl text-ink-primary">Work</h2>
        {member.work.length > 0 && (
          <p className="text-sm text-ink-secondary">
            {[workSummary(member.work.length), confirmedSummary(member.confirmedWorkCount)].filter(Boolean).join(" · ")}
          </p>
        )}
      </div>
      {member.work.length > 0 ? (
        <ul className="flex flex-col">
          {member.work.map((work) => <WorkItem key={work.id} work={work} />)}
        </ul>
      ) : (
        <EmptyState
          title={member.isOwn ? "You haven't posted any work yet" : `${first} hasn't posted any work yet`}
          action={member.isOwn ? <ButtonLink href={postWorkHref()}>Post your work</ButtonLink> : undefined}
        >
          {member.isOwn
            ? "Something you made or helped make, with a link to it. Mentors can confirm what they review."
            : "When they do, it shows here, with what any mentor confirmed."}
        </EmptyState>
      )}
    </section>
  );
}
