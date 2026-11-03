import { and, count, desc, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import { createCommunityService } from "@/lib/community/service";
import type { CommunityJourney } from "@/lib/community/model";
import { recordError } from "@/lib/observability/errors";
import { hasCompletedCohort } from "@/lib/talent/eligibility";
import { parseSkillsJson } from "@/lib/talent/profile";
import { resolveGateState } from "@/components/hire/validation";
import type { StudentJourney } from "@/lib/student/journey";
import { mentorRequestsOpen } from "@/components/platform/mentors/mentor-display";
import { loadCertificates, type SpacePageContext } from "@/components/platform/spaces/space-page";
import { OVERVIEW_LIMITS, type OverviewFacts } from "./overview";

/*
 * The Profile Overview's reads (T01). Read-only, and each one is the person's own: their public
 * builder profile, their contributions through the community service (which applies the same
 * staging and fixture scopes as the Your journey API), their unopened visitor messages, their
 * writing drafts, the approved client projects the Opportunities page lists, and their
 * certificates. Nothing here grants anything; every linked page still authorises itself.
 */

/** The person's own contributions, or null (recorded) when the service refuses or fails: the page says so. */
async function ownJourney(locals: App.Locals, userId: string): Promise<CommunityJourney[] | null> {
  try {
    const service = createCommunityService(env.DB, userId, locals.stagingFixture, env.DEPLOYMENT_ENVIRONMENT, env.PLATFORM_FLAGS_OVERRIDE);
    return await service.listJourney();
  } catch (error) {
    // recordError never throws; it reports its own ledger failures.
    await recordError(env.DB, { source: "request", route: "/dashboard/me", error, level: "warning" });
    return null;
  }
}

async function profileFacts(db: Database, userId: string) {
  const profile = await db.query.studentProfile.findFirst({
    where: eq(schema.studentProfile.userId, userId),
    columns: {
      id: true, status: true, handle: true, headline: true, bio: true, location: true, country: true, skills: true,
      publicName: true, publicAvatarUrl: true,
    },
  });
  if (!profile) return { profile: null, leads: { items: [], total: 0 }, drafts: [] };
  const [leadRows, [leadCount], drafts] = await Promise.all([
    db.query.profileContact.findMany({
      where: and(eq(schema.profileContact.profileId, profile.id), eq(schema.profileContact.status, "NEW")),
      columns: { id: true, fromName: true, organization: true },
      orderBy: [desc(schema.profileContact.createdAt)],
      limit: OVERVIEW_LIMITS.leads,
    }),
    db.select({ value: count() }).from(schema.profileContact)
      .where(and(eq(schema.profileContact.profileId, profile.id), eq(schema.profileContact.status, "NEW"))),
    db.query.blogPost.findMany({
      where: and(eq(schema.blogPost.profileId, profile.id), eq(schema.blogPost.status, "DRAFT")),
      columns: { id: true, title: true },
      orderBy: [desc(schema.blogPost.updatedAt)],
      limit: OVERVIEW_LIMITS.drafts,
    }),
  ]);
  return {
    profile,
    leads: { items: leadRows, total: Number(leadCount?.value ?? 0) },
    drafts,
  };
}

/**
 * The approved client projects the Opportunities page lists, with the person's raised hands, read
 * only while that page is open to them: their journey has unlocked it (`open`) and its own gate,
 * a published profile, lets them in. Otherwise nothing is read, so no title or organisation can
 * reach someone the Opportunities page would refuse.
 */
export async function opportunityFacts(db: Database, profile: { id: string; status: "DRAFT" | "PUBLISHED" | "SUSPENDED" } | null, open: boolean) {
  const gate = resolveGateState(profile).state;
  if (!open || gate !== "published" || !profile) return { gate, items: [] };
  const [projects, interests] = await Promise.all([
    db.query.clientProject.findMany({
      where: eq(schema.clientProject.status, "APPROVED"),
      columns: { id: true, title: true, organization: true },
      orderBy: [desc(schema.clientProject.createdAt)],
      limit: OVERVIEW_LIMITS.opportunities + 1,
    }),
    db.query.projectInterest.findMany({
      where: and(eq(schema.projectInterest.profileId, profile.id), eq(schema.projectInterest.status, "INTERESTED")),
      columns: { projectId: true },
    }),
  ]);
  const raised = new Set(interests.map((interest) => interest.projectId));
  return { gate, items: projects.map((project) => ({ ...project, interested: raised.has(project.id) })) };
}

export async function loadProfileOverview(
  locals: App.Locals, db: Database, context: SpacePageContext, journey: StudentJourney,
): Promise<OverviewFacts> {
  const { me } = context;
  const userId = me.user.id;
  const [eligible, own, contributions, certificates] = await Promise.all([
    hasCompletedCohort(db, userId),
    profileFacts(db, userId),
    ownJourney(locals, userId),
    loadCertificates(db, userId),
  ]);
  const opportunities = await opportunityFacts(db, own.profile, journey.visibleLinkIds.includes("opportunities"));
  const profile = own.profile;
  return {
    person: { id: userId, name: me.user.name, image: me.user.avatarUrl },
    journeyState: journey.state,
    visibleLinkIds: journey.visibleLinkIds,
    eligible,
    profile: profile && {
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
    leads: own.leads,
    drafts: own.drafts,
    opportunities,
    certificates,
    mentorRequests: mentorRequestsOpen(me),
    framing: context.onboarding?.framing ?? null,
  };
}
