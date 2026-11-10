import type { MemberCard as MemberCardData } from "@/lib/members/directory";
import { SPACE_PATHS } from "@/lib/platform/server/space-routes";
import { ButtonLink, Card, linkClass } from "@/components/platform/ui";
import MemberCard from "./MemberCard";
import { profileEditorHref } from "./member-display";

/**
 * Where the caller stands: listed (with their own card), a mentor or staff (whom the directory
 * never lists), or not listed yet, which covers both no saved profile and one waiting for a check.
 */
export type YouStanding = { kind: "listed"; card: MemberCardData } | { kind: "mentor" } | { kind: "staff" } | { kind: "unlisted" };

/** The standing the page shows, from the caller's own card and their roles. Staff wins over mentor, as in the eligibility rule. */
export function youStanding(card: MemberCardData | null, capabilities: { isAdmin: boolean; isMentor: boolean }): YouStanding {
  if (card) return { kind: "listed", card };
  if (capabilities.isAdmin) return { kind: "staff" };
  if (capabilities.isMentor) return { kind: "mentor" };
  return { kind: "unlisted" };
}

const COPY = {
  listed: {
    title: "You're in the directory",
    body: "This is your card, as everyone signed in to TTV sees it. It opens your member page.",
  },
  unlisted: {
    title: "Your profile isn't in the directory yet",
    body: "Once it is, everyone signed in to TTV can find it here. Open your profile to see where it stands.",
  },
  mentor: {
    title: "Mentors aren't listed here",
    body: "This directory is for members. Your mentoring is in the Mentoring space.",
  },
  staff: {
    title: "Staff aren't listed here",
    body: "You see the directory exactly as members do.",
  },
} as const satisfies Record<YouStanding["kind"], { title: string; body: string }>;

/**
 * The caller, at the top of the directory. The list never includes the person reading it (one
 * eligibility rule everywhere, policy 4bcc461e), so this says where they stand, in words true for
 * every case it covers: never "make your profile" to someone whose profile is only waiting.
 */
export default function YouCard({ standing }: { standing: YouStanding }) {
  const { title, body } = COPY[standing.kind];
  if (standing.kind === "listed") {
    // People see exactly what others see: their own card, as the list draws it.
    return (
      <section aria-labelledby="member-you-title" className="flex flex-col gap-4" data-member-you="listed">
        <div className="flex flex-wrap items-end justify-between gap-x-5 gap-y-2">
          <div className="min-w-0">
            <h2 id="member-you-title" className="text-lg leading-snug text-ink-primary">{title}</h2>
            <p className="mt-1 max-w-prose text-[0.9375rem] leading-relaxed text-ink-secondary">{body}</p>
          </div>
          <a href={profileEditorHref()} className={linkClass("inline-flex min-h-11 items-center")}>Edit your profile</a>
        </div>
        <ul className="member-grid" aria-label="Your card">
          <MemberCard member={standing.card} />
        </ul>
      </section>
    );
  }
  return (
    <Card as="section" aria-labelledby="member-you-title" className="flex flex-wrap items-center gap-x-5 gap-y-4" data-member-you={standing.kind}>
      <div className="min-w-0 flex-1 basis-64">
        <h2 id="member-you-title" className="text-lg leading-snug text-ink-primary">{title}</h2>
        <p className="mt-1 max-w-prose text-[0.9375rem] leading-relaxed text-ink-secondary">{body}</p>
      </div>
      {standing.kind === "unlisted" && <ButtonLink href={profileEditorHref()} variant="primary">Open your profile</ButtonLink>}
      {standing.kind === "mentor" && <ButtonLink href={SPACE_PATHS.mentoring}>Open Mentoring</ButtonLink>}
    </Card>
  );
}
