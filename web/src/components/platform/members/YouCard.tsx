import type { MemberCard } from "@/lib/members/directory";
import { SPACE_PATHS } from "@/lib/platform/server/space-routes";
import { Avatar, ButtonLink, Card, linkClass } from "@/components/platform/ui";
import { memberHref, profileEditorHref } from "./member-display";

/**
 * Where the caller stands: listed (with their own card), a mentor or staff (whom the directory
 * never lists), or not listed yet, which covers both no saved profile and one waiting for a check.
 */
export type YouStanding = { kind: "listed"; card: MemberCard } | { kind: "mentor" } | { kind: "staff" } | { kind: "unlisted" };

/** The standing the page shows, from the caller's own card and their roles. Staff wins over mentor, as in the eligibility rule. */
export function youStanding(card: MemberCard | null, capabilities: { isAdmin: boolean; isMentor: boolean }): YouStanding {
  if (card) return { kind: "listed", card };
  if (capabilities.isAdmin) return { kind: "staff" };
  if (capabilities.isMentor) return { kind: "mentor" };
  return { kind: "unlisted" };
}

const COPY = {
  listed: {
    title: "You're in the directory",
    body: "Everyone signed in to TTV sees your card and your page the way you see them here.",
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
  return (
    <Card as="section" aria-labelledby="member-you-title" className="flex flex-wrap items-center gap-x-5 gap-y-4" data-member-you={standing.kind}>
      {standing.kind === "listed" && (
        <Avatar id={standing.card.handle} name={standing.card.displayName} src={standing.card.avatarUrl ?? undefined} size="lg" decorative />
      )}
      <div className="min-w-0 flex-1 basis-64">
        <h2 id="member-you-title" className="text-lg leading-snug text-ink-primary">{title}</h2>
        <p className="mt-1 max-w-prose text-[0.9375rem] leading-relaxed text-ink-secondary">{body}</p>
      </div>
      {standing.kind !== "staff" && (
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {standing.kind === "listed" && (
            <>
              <ButtonLink href={memberHref(standing.card.handle)}>See your page</ButtonLink>
              <a href={profileEditorHref()} className={linkClass("inline-flex min-h-11 items-center")}>Edit your profile</a>
            </>
          )}
          {standing.kind === "unlisted" && <ButtonLink href={profileEditorHref()} variant="primary">Open your profile</ButtonLink>}
          {standing.kind === "mentor" && <ButtonLink href={SPACE_PATHS.mentoring}>Open Mentoring</ButtonLink>}
        </div>
      )}
    </Card>
  );
}
