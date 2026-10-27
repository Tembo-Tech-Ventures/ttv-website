import { and, asc, desc, eq, isNotNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import { getInitials } from "@/components/talent/directory-helpers";
import { loadPublicPageData } from "@/lib/public-page-data";
import { isValidCompletion, type CompletionState } from "@/lib/talent/eligibility";
import { parseSkillsJson } from "@/lib/talent/profile";
import { resolvePublicProfileIdentity, type PublicIdentitySnapshot } from "@/lib/talent/public-identity";

/** What a homepage builder showcase needs to know about one public profile. */
export interface HomepageBuilder {
  handle: string;
  href: string;
  name: string;
  image: string | null;
  initials: string;
  headline: string | null;
  cohort: string | null;
  country: string | null;
  skills: string[];
  project: { name: string; description: string | null; language: string | null } | null;
}

export interface BuilderProfileRow extends PublicIdentitySnapshot {
  handle: string;
  headline: string | null;
  country: string | null;
  skills: string | null;
  highlights: Array<{ repoFullName: string; description: string | null; language: string | null }>;
  user: {
    programApplications: Array<CompletionState & { program: { name: string } | null }>;
  };
}

const MAX_SKILLS = 3;

/** Profiles without a completed cohort are not public builders, so they map to null. */
export function toHomepageBuilder(profile: BuilderProfileRow): HomepageBuilder | null {
  const completion = profile.user.programApplications.find(isValidCompletion);
  if (!completion) return null;
  const identity = resolvePublicProfileIdentity(profile);
  const highlight = profile.highlights[0];
  return {
    handle: profile.handle,
    href: `/talent/${profile.handle}`,
    name: identity.name,
    image: identity.image,
    initials: getInitials(identity.name),
    headline: profile.headline?.trim() || null,
    cohort: completion.program?.name ?? null,
    country: profile.country?.trim() || null,
    // Stored by serializeSkills as a JSON array, the same as the talent pages read.
    skills: parseSkillsJson(profile.skills)
      .map((skill) => skill.trim())
      .filter(Boolean)
      .slice(0, MAX_SKILLS),
    project: highlight
      ? {
          name: highlight.repoFullName.split("/").pop() ?? highlight.repoFullName,
          description: highlight.description?.trim() || null,
          language: highlight.language,
        }
      : null,
  };
}

/** Most recently published public builders first. */
export async function loadHomepageBuilders(db: Database, limit = 8): Promise<HomepageBuilder[]> {
  const profiles = await db.query.studentProfile.findMany({
    where: eq(schema.studentProfile.status, "PUBLISHED"),
    orderBy: desc(schema.studentProfile.publishedAt),
    columns: {
      handle: true,
      headline: true,
      country: true,
      skills: true,
      publicName: true,
      publicAvatarUrl: true,
    },
    with: {
      highlights: {
        orderBy: asc(schema.profileHighlight.sortOrder),
        limit: 1,
        columns: { repoFullName: true, description: true, language: true },
      },
      user: {
        columns: { id: true },
        with: {
          programApplications: {
            where: and(
              eq(schema.programApplication.status, "COMPLETED"),
              isNotNull(schema.programApplication.completedAt),
            ),
            orderBy: desc(schema.programApplication.completedAt),
            columns: { status: true, completedAt: true },
            with: { program: { columns: { name: true } } },
          },
        },
      },
    },
  });
  return profiles.flatMap((profile) => toHomepageBuilder(profile) ?? []).slice(0, limit);
}

/** Loads the showcase without letting a D1 overload take the homepage down. */
export async function loadHomepageBuildersSafely(options: {
  d1: D1Database;
  route: string;
  version?: string;
  waitUntil?: Pick<ExecutionContext, "waitUntil">;
  limit?: number;
}): Promise<HomepageBuilder[]> {
  const db = drizzle(options.d1, { schema });
  const read = await loadPublicPageData({
    db: options.d1,
    fallback: [],
    load: () => loadHomepageBuilders(db, options.limit),
    route: options.route,
    version: options.version,
    waitUntil: options.waitUntil,
  });
  return read.data;
}
