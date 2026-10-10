import { and, asc, count, desc, eq } from "drizzle-orm";
import { resolveGateState } from "@/components/hire/validation";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import { getAccessibleProgramIds } from "@/lib/recordings/access";
import { hasCompletedCohort, isValidCompletion } from "@/lib/talent/eligibility";

export const STUDENT_DASHBOARD_LINK_IDS = [
  "home",
  "apply",
  "sessions",
  "ask",
  "profile",
  "writing",
  "opportunities",
  "leads",
  "account",
  "logout",
] as const;

export type StudentDashboardLinkId =
  (typeof STUDENT_DASHBOARD_LINK_IDS)[number];

export type StudentJourneyState =
  | "no_application"
  | "pending"
  | "audit"
  | "rejected"
  | "accepted"
  | "completed"
  | "published";

type ApplicationStatus = typeof schema.programApplication.$inferSelect.status;

interface JourneyProgram {
  id: string;
  name: string;
  startDate: Date | null;
  endDate: Date | null;
}

interface JourneyApplication {
  id: string;
  status: ApplicationStatus;
  completedAt: Date | null;
  createdAt: Date;
  program: JourneyProgram | null;
}

export interface StudentNextStep {
  title: string;
  description: string;
  detail: string | null;
  action: {
    href: string;
    label: string;
  };
}

export interface StudentJourney {
  state: StudentJourneyState;
  visibleLinkIds: StudentDashboardLinkId[];
  unreadLeadCount: number;
  nextStep: StudentNextStep;
}

const APPLICATION_STATE_PRIORITY: ApplicationStatus[] = [
  "COMPLETED",
  "APPROVED",
  "AUDIT",
  "PENDING",
  "REJECTED",
];

export function formatJourneyDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatProgramDates(program: JourneyProgram | null): string | null {
  if (!program?.startDate) return null;

  const start = formatJourneyDate(program.startDate);
  return program.endDate
    ? `${start} – ${formatJourneyDate(program.endDate)}`
    : `Starts ${start}`;
}

function pickApplication(
  applications: JourneyApplication[],
  status: ApplicationStatus
): JourneyApplication | null {
  return applications.find((application) => application.status === status) ?? null;
}

function formatApplicationDetail(
  application: JourneyApplication | null
): string | null {
  if (!application?.program) return null;
  return [application.program.name, formatProgramDates(application.program)]
    .filter(Boolean)
    .join(" · ");
}

export function deriveJourneyState({
  applications,
  hasEligibleCompletion,
  profileIsPublished,
}: {
  applications: Array<Pick<JourneyApplication, "status" | "completedAt">>;
  hasEligibleCompletion: boolean;
  profileIsPublished: boolean;
}): StudentJourneyState {
  if (profileIsPublished) return "published";
  if (hasEligibleCompletion) return "completed";

  const highestStatus = APPLICATION_STATE_PRIORITY.find((status) =>
    applications.some((application) => application.status === status)
  );

  switch (highestStatus) {
    case "COMPLETED":
      // A legacy COMPLETED row without completedAt is not a valid graduation.
      return "accepted";
    case "APPROVED":
      return "accepted";
    case "AUDIT":
      return "audit";
    case "PENDING":
      return "pending";
    case "REJECTED":
      return "rejected";
    default:
      return "no_application";
  }
}

function buildVisibleLinkIds({
  hasCohortAccess,
  profileEligible,
  profileGateState,
}: {
  hasCohortAccess: boolean;
  profileEligible: boolean;
  profileGateState: ReturnType<typeof resolveGateState>["state"];
}): StudentDashboardLinkId[] {
  return [
    "home",
    "apply",
    ...(hasCohortAccess ? (["sessions"] as const) : []),
    "ask",
    ...(profileEligible ? (["profile"] as const) : []),
    ...(profileGateState === "published" ? (["writing"] as const) : []),
    ...(profileGateState === "published" ? (["opportunities"] as const) : []),
    ...(profileGateState !== "no_profile" ? (["leads"] as const) : []),
    "account",
    "logout",
  ];
}

function buildNextStep({
  state,
  applications,
  openProgram,
  unreadLeadCount,
}: {
  state: StudentJourneyState;
  applications: JourneyApplication[];
  openProgram: JourneyProgram | null;
  unreadLeadCount: number;
}): StudentNextStep {
  const completed = applications.find(isValidCompletion) ?? null;
  const accepted = pickApplication(applications, "APPROVED");
  const audit = pickApplication(applications, "AUDIT");
  const pending = pickApplication(applications, "PENDING");
  const rejected = pickApplication(applications, "REJECTED");

  switch (state) {
    case "published":
      return buildPublishedNextStep(unreadLeadCount);
    case "completed":
      return buildCompletedNextStep(completed);
    case "accepted":
      return buildAcceptedNextStep(accepted);
    case "audit":
      return buildAuditNextStep(audit);
    case "pending":
      return buildPendingNextStep(pending);
    case "rejected":
      return buildRejectedNextStep(rejected, openProgram);
    case "no_application":
      return buildNoApplicationNextStep(openProgram);
  }
}

function buildPublishedNextStep(unreadLeadCount: number): StudentNextStep {
  const hasUnreadLeads = unreadLeadCount > 0;
  return {
    title: "Your builder profile is live",
    description: hasUnreadLeads
      ? `You have ${unreadLeadCount} unread ${unreadLeadCount === 1 ? "message" : "messages"} from the TTV community.`
      : "Your work is part of TTV's community of builders across Africa. See where your skills could connect next.",
    detail: null,
    action: hasUnreadLeads
      ? { href: "/dashboard/leads", label: "Read messages" }
      : { href: "/dashboard/opportunities", label: "See opportunities" },
  };
}

function buildCompletedNextStep(
  completed: JourneyApplication | null
): StudentNextStep {
  return {
    title: "Your certificate is ready",
    description:
      "Your certificate records what you built and learned alongside your cohort.",
    detail: formatApplicationDetail(completed),
    action: {
      href: completed ? `/certificate/${completed.id}` : "/dashboard/portfolio",
      label: completed ? "View certificate" : "Build your profile",
    },
  };
}

function buildAcceptedNextStep(
  accepted: JourneyApplication | null
): StudentNextStep {
  return {
    title: "Start with your cohort sessions",
    description:
      "You are part of the cohort. Revisit each session and use Ask AI as you build with the community.",
    detail: formatApplicationDetail(accepted),
    action: { href: "/dashboard/sessions", label: "Watch sessions" },
  };
}

function buildAuditNextStep(audit: JourneyApplication | null): StudentNextStep {
  return {
    title: "Keep learning with the cohort",
    description:
      "As an audit participant, you can follow the session recordings and keep learning alongside builders across Africa.",
    detail: formatApplicationDetail(audit),
    action: { href: "/dashboard/sessions", label: "Watch sessions" },
  };
}

function buildPendingNextStep(
  pending: JourneyApplication | null
): StudentNextStep {
  return {
    title: "Your application is with the team",
    description:
      "We read every application carefully. You can return here at any time to follow its status.",
    detail: formatApplicationDetail(pending),
    action: {
      href: pending ? `/dashboard/application/${pending.id}` : "/dashboard/apply",
      label: "View application",
    },
  };
}

function buildRejectedNextStep(
  rejected: JourneyApplication | null,
  openProgram: JourneyProgram | null
): StudentNextStep {
  return {
    title: "Keep building with the community",
    description:
      "This cohort was not the right match. Keep sharing what you learn and stay connected to Africa's builder community.",
    detail: openProgram
      ? [
          `${openProgram.name} is accepting applications`,
          formatProgramDates(openProgram),
        ]
          .filter(Boolean)
          .join(" · ")
      : rejected?.program?.name ?? null,
    action: openProgram
      ? { href: "/dashboard/apply", label: "See the next cohort" }
      : { href: "/blog", label: "Read community stories" },
  };
}

function buildNoApplicationNextStep(
  openProgram: JourneyProgram | null
): StudentNextStep {
  return {
    title: openProgram ? `Apply to ${openProgram.name}` : "Find your next cohort",
    description:
      "TTV cohorts bring builders across Africa together to learn, make useful technology and build lasting relationships.",
    detail: openProgram ? formatProgramDates(openProgram) : null,
    action: {
      href: "/dashboard/apply",
      label: openProgram ? "Apply" : "View cohorts",
    },
  };
}

export async function getStudentJourney(
  db: Database,
  userId: string
): Promise<StudentJourney> {
  const [applications, accessibleProgramIds, profileEligible, profile, openProgram] =
    await Promise.all([
      db.query.programApplication.findMany({
        where: eq(schema.programApplication.userId, userId),
        with: { program: true },
        orderBy: [desc(schema.programApplication.updatedAt)],
      }),
      getAccessibleProgramIds(db, userId),
      hasCompletedCohort(db, userId),
      db.query.studentProfile.findFirst({
        where: eq(schema.studentProfile.userId, userId),
        columns: { id: true, status: true },
      }),
      db.query.program.findFirst({
        where: eq(schema.program.applicationsOpen, true),
        columns: { id: true, name: true, startDate: true, endDate: true },
        orderBy: [asc(schema.program.startDate)],
      }),
    ]);

  const profileGate = resolveGateState(profile);
  // Writing and Opportunities share the published-profile gate today, while
  // Leads opens as soon as that resolver sees any profile. Deriving all three
  // from the existing resolver keeps navigation aligned with those pages
  // without creating another profile-status policy here.
  const unreadLeadCount = profile
    ? Number(
        (
          await db
            .select({ value: count() })
            .from(schema.profileContact)
            .where(
              and(
                eq(schema.profileContact.profileId, profile.id),
                eq(schema.profileContact.status, "NEW")
              )
            )
        )[0]?.value ?? 0
      )
    : 0;

  const journeyApplications = applications as JourneyApplication[];
  const state = deriveJourneyState({
    applications: journeyApplications,
    hasEligibleCompletion: profileEligible,
    profileIsPublished: profileGate.state === "published",
  });

  return {
    state,
    visibleLinkIds: buildVisibleLinkIds({
      hasCohortAccess: accessibleProgramIds.length > 0,
      profileEligible,
      profileGateState: profileGate.state,
    }),
    unreadLeadCount,
    nextStep: buildNextStep({
      state,
      applications: journeyApplications,
      openProgram: openProgram ?? null,
      unreadLeadCount,
    }),
  };
}
