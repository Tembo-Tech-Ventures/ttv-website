import { memberEligibility, publicProfileEligibility } from "@/lib/community/eligibility";
import { sql } from "drizzle-orm";
import { and, desc, eq, exists, inArray } from "drizzle-orm";
import { env } from "cloudflare:workers";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import { createCommunityService } from "@/lib/community/service";
import type { CommunityJourney } from "@/lib/community/model";
import { recordError } from "@/lib/observability/errors";
import { parseSkillsJson } from "@/lib/talent/profile";
import { resolveGateState } from "@/components/hire/validation";
import { getStudentJourney } from "@/lib/student/journey";
import { mentorRequestsOpen } from "@/components/platform/mentors/mentor-display";
import {
  loadCertificates,
  type SpacePageContext,
} from "@/components/platform/spaces/space-page";
import { OVERVIEW_LIMITS, type OverviewFacts } from "./overview";

/*
 * The Profile Overview's reads (T01). Read-only, and each one is the person's own: their public
 * profile, their contributions through the community service (which applies the same
 * staging and fixture scopes as the Your journey API), their unopened visitor messages, their
 * writing drafts, the approved client projects the Opportunities page lists, and their
 * certificates. Nothing here grants anything; every linked page still authorises itself.
 */

/** The person's own contributions, or null (recorded) when the service refuses or fails: the page says so. */
async function ownJourney(
  locals: App.Locals,
  userId: string,
): Promise<CommunityJourney[] | null> {
  try {
    const service = createCommunityService(
      env.DB,
      userId,
      locals.stagingFixture,
      env.DEPLOYMENT_ENVIRONMENT,
      env.PLATFORM_FLAGS_OVERRIDE,
      env,
    );
    return await service.listJourney();
  } catch (error) {
    // recordError never throws; it reports its own ledger failures.
    await recordError(env.DB, {
      source: "request",
      route: "/dashboard/me",
      error,
      level: "warning",
    });
    return null;
  }
}

/** The person's profile, as a subquery, so what hangs off it is read beside it. */
function ownProfileId(db: Database, userId: string, status?: "PUBLISHED") {
  return db
    .select({ id: schema.studentProfile.id })
    .from(schema.studentProfile)
    .where(
      and(
        eq(schema.studentProfile.userId, userId),
        status && eq(schema.studentProfile.status, status),
      ),
    );
}

/**
 * The profile and what hangs off it, in one round trip: unopened visitor messages,
 * writing drafts and the Opportunities page's projects, each found through the profile's subquery
 * rather than after it. The count of unopened messages is the journey's.
 */
async function profileFacts(db: Database, userId: string) {
  const [profile, leads, drafts, opportunities] = await Promise.all([
    db.query.studentProfile.findFirst({
      where: eq(schema.studentProfile.userId, userId),
      extras: {
        onPublicSite: sql<number>`${sql.raw(publicProfileEligibility("studentProfile"))}`.as("onPublicSite"),
        // Listed in the Members directory, by the same rule the directory reads with.
        listed: sql<number>`${sql.raw(memberEligibility("studentProfile.userId"))}`.as("listed"),
      },
      columns: {
        id: true,
        status: true,
        handle: true,
        headline: true,
        bio: true,
        location: true,
        country: true,
        skills: true,
        publicName: true,
        publicAvatarUrl: true,
        publishedAt: true,
      },
    }),
    db.query.profileContact.findMany({
      where: and(
        inArray(schema.profileContact.profileId, ownProfileId(db, userId)),
        eq(schema.profileContact.status, "NEW"),
      ),
      columns: { id: true, fromName: true, organization: true },
      orderBy: [desc(schema.profileContact.createdAt)],
      limit: OVERVIEW_LIMITS.leads,
    }),
    db.query.blogPost.findMany({
      where: and(
        inArray(schema.blogPost.profileId, ownProfileId(db, userId)),
        eq(schema.blogPost.status, "DRAFT"),
      ),
      columns: { id: true, title: true },
      orderBy: [desc(schema.blogPost.updatedAt)],
      limit: OVERVIEW_LIMITS.drafts,
    }),
    opportunityFacts(db, userId),
  ]);
  const gate = resolveGateState(profile).state;
  return {
    profile: profile ?? null,
    leads,
    drafts,
    // The SQL applies the same gate; this keeps the two from ever disagreeing on the page.
    opportunities: { gate, items: gate === "published" ? opportunities : [] },
  };
}

/**
 * The approved client projects the Opportunities page lists, with the person's raised hands, read
 * only past that page's own gate, a published profile, which the query itself applies: for anyone
 * else no title or organisation is read, so none can reach someone the Opportunities page would refuse.
 */
export async function opportunityFacts(db: Database, userId: string) {
  const [projects, interests] = await Promise.all([
    db.query.clientProject.findMany({
      where: and(
        eq(schema.clientProject.status, "APPROVED"),
        exists(ownProfileId(db, userId, "PUBLISHED")),
      ),
      columns: { id: true, title: true, organization: true },
      orderBy: [desc(schema.clientProject.createdAt)],
      limit: OVERVIEW_LIMITS.opportunities + 1,
    }),
    db.query.projectInterest.findMany({
      where: and(
        inArray(
          schema.projectInterest.profileId,
          ownProfileId(db, userId, "PUBLISHED"),
        ),
        eq(schema.projectInterest.status, "INTERESTED"),
      ),
      columns: { projectId: true },
    }),
  ]);
  const raised = new Set(interests.map((interest) => interest.projectId));
  return projects.map((project) => ({
    ...project,
    interested: raised.has(project.id),
  }));
}

/**
 * Everything the Overview reads, with the journey the frame shares (getStudentJourney is read once
 * per request). It needs only the person's id, so the page starts it beside the space context: every
 * read here is one round trip.
 */
export async function readProfileOverview(
  locals: App.Locals,
  db: Database,
  userId: string,
) {
  const [journey, own, contributions, certificates] = await Promise.all([
    getStudentJourney(db, userId),
    profileFacts(db, userId),
    ownJourney(locals, userId),
    loadCertificates(db, userId),
  ]);
  return { journey, own, contributions, certificates };
}

/** The Overview's facts, from its reads and the page's space context. */
export function profileOverviewFacts(
  {
    journey,
    own,
    contributions,
    certificates,
  }: Awaited<ReturnType<typeof readProfileOverview>>,
  context: SpacePageContext,
): OverviewFacts {
  const { me } = context;
  const profile = own.profile;
  // The journey unlocks the Opportunities link on the same published-profile gate opportunityFacts
  // applies; if the two reads of the profile ever disagree, the locked side wins.
  const opportunities = journey.visibleLinkIds.includes("opportunities")
    ? own.opportunities
    : { gate: own.opportunities.gate, items: [] };
  return {
    person: { id: me.user.id, name: me.user.name, image: me.user.avatarUrl },
    visibleLinkIds: journey.visibleLinkIds,
    // The journey shows the profile editor to whoever has completed a cohort (hasCompletedCohort).
    eligible: journey.visibleLinkIds.includes("profile"),
    staff: me.capabilities.isMentor || me.capabilities.isAdmin,
    profile: profile && {
      onPublicSite: profile.onPublicSite,
      listed: profile.listed,
      everListed: Boolean(profile.publishedAt),
      status: profile.status,
      handle: profile.handle,
      headline: profile.headline,
      bio: profile.bio,
      location: profile.location,
      country: profile.country,
      skills: parseSkillsJson(profile.skills),
      publicName: profile.publicName,
      publicAvatarUrl: profile.publicAvatarUrl,
    },
    journey: contributions,
    leads: { items: own.leads, total: profile ? journey.unreadLeadCount : 0 },
    drafts: own.drafts,
    opportunities,
    certificates,
    mentorRequests: mentorRequestsOpen(me),
  };
}
