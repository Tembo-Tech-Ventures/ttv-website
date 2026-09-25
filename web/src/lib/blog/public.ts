import { and, desc, eq, isNotNull } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import { isValidCompletion, type CompletionState } from "@/lib/talent/eligibility";

export interface PublicProfile {
  id: string;
  handle: string;
  headline: string | null;
  bio: string | null;
  updatedAt: Date;
  user: {
    id: string;
    name: string;
    image: string | null;
  };
}

export interface PublicPostSummary {
  id: string;
  slug: string;
  title: string;
  excerpt: string | null;
  readingMinutes: number;
  coverImageKey: string | null;
  coverImageAlt: string | null;
  publishedAt: Date;
  updatedAt: Date;
  profile: PublicProfile;
}

export interface PublicPost extends PublicPostSummary {
  contentHtml: string;
}

interface PublicProfileCandidate {
  status: string;
  user: {
    programApplications: CompletionState[];
  };
}

interface PublicProfileRow extends PublicProfileCandidate {
  id: string;
  handle: string;
  headline: string | null;
  bio: string | null;
  updatedAt: Date;
  user: PublicProfileCandidate["user"] & {
    id: string;
    name: string;
    image: string | null;
  };
}

/**
 * The public blog and the talent directory share one eligibility rule.
 * Keeping the final defensive check here means a future query change cannot
 * expose a profile with a legacy COMPLETED row that has no completion date.
 */
export function isEligiblePublicProfile(
  profile: PublicProfileCandidate | null | undefined
): boolean {
  return Boolean(
    profile?.status === "PUBLISHED" &&
      profile.user.programApplications.some(isValidCompletion)
  );
}

const profileColumns = {
  id: true,
  handle: true,
  status: true,
  headline: true,
  bio: true,
  updatedAt: true,
} as const;

const postColumns = {
  id: true,
  slug: true,
  title: true,
  status: true,
  excerpt: true,
  readingMinutes: true,
  coverImageKey: true,
  coverImageAlt: true,
  publishedAt: true,
  updatedAt: true,
} as const;

type EligibleProfileRow = Awaited<
  ReturnType<typeof queryEligibleProfileRowsWithPosts>
>[number];

async function queryEligibleProfileRowsWithPosts(db: Database) {
  const rows = await db.query.studentProfile.findMany({
    where: eq(schema.studentProfile.status, "PUBLISHED"),
    columns: profileColumns,
    with: {
      user: {
        columns: { id: true, name: true, image: true },
        with: {
          programApplications: {
            where: and(
              eq(schema.programApplication.status, "COMPLETED"),
              isNotNull(schema.programApplication.completedAt)
            ),
            columns: { status: true, completedAt: true },
          },
        },
      },
      posts: {
        where: eq(schema.blogPost.status, "PUBLISHED"),
        orderBy: [
          desc(schema.blogPost.publishedAt),
          desc(schema.blogPost.updatedAt),
        ],
        columns: postColumns,
      },
    },
  });

  return rows.filter(isEligiblePublicProfile);
}

function toPublicProfile(row: PublicProfileRow): PublicProfile {
  return {
    id: row.id,
    handle: row.handle,
    headline: row.headline,
    bio: row.bio,
    updatedAt: row.updatedAt,
    user: {
      id: row.user.id,
      name: row.user.name,
      image: row.user.image,
    },
  };
}

function toPublicPosts(row: EligibleProfileRow): PublicPostSummary[] {
  const profile = toPublicProfile(row);
  return row.posts
    .filter((post) => post.status === "PUBLISHED")
    .map((post) => ({
      id: post.id,
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      readingMinutes: post.readingMinutes,
      coverImageKey: post.coverImageKey,
      coverImageAlt: post.coverImageAlt,
      publishedAt: post.publishedAt ?? post.updatedAt,
      updatedAt: post.updatedAt,
      profile,
    }));
}

export async function listPublicProfiles(db: Database): Promise<PublicProfile[]> {
  const rows = await db.query.studentProfile.findMany({
    where: eq(schema.studentProfile.status, "PUBLISHED"),
    columns: profileColumns,
    with: {
      user: {
        columns: { id: true, name: true, image: true },
        with: {
          programApplications: {
            where: and(
              eq(schema.programApplication.status, "COMPLETED"),
              isNotNull(schema.programApplication.completedAt)
            ),
            columns: { status: true, completedAt: true },
          },
        },
      },
    },
  });

  return rows.filter(isEligiblePublicProfile).map(toPublicProfile);
}

export async function listPublicPosts(
  db: Database,
  options: { limit?: number } = {}
): Promise<PublicPostSummary[]> {
  const posts = (await queryEligibleProfileRowsWithPosts(db))
    .flatMap(toPublicPosts)
    .toSorted((left, right) => {
      const published = right.publishedAt.getTime() - left.publishedAt.getTime();
      if (published !== 0) return published;
      return right.updatedAt.getTime() - left.updatedAt.getTime();
    });

  return options.limit === undefined ? posts : posts.slice(0, options.limit);
}

export async function findPublicPost(
  db: Database,
  handle: string,
  slug: string
): Promise<
  { post: PublicPost; more: PublicPostSummary[] } | undefined
> {
  const row = await db.query.studentProfile.findFirst({
    where: and(
      eq(schema.studentProfile.handle, handle),
      eq(schema.studentProfile.status, "PUBLISHED")
    ),
    columns: profileColumns,
    with: {
      user: {
        columns: { id: true, name: true, image: true },
        with: {
          programApplications: {
            where: and(
              eq(schema.programApplication.status, "COMPLETED"),
              isNotNull(schema.programApplication.completedAt)
            ),
            columns: { status: true, completedAt: true },
          },
        },
      },
      posts: {
        where: eq(schema.blogPost.status, "PUBLISHED"),
        orderBy: [
          desc(schema.blogPost.publishedAt),
          desc(schema.blogPost.updatedAt),
        ],
        columns: { ...postColumns, contentHtml: true },
      },
    },
  });

  if (!row || !isEligiblePublicProfile(row)) return undefined;

  const posts = toPublicPosts(row);
  const summary = posts.find((candidate) => candidate.slug === slug);
  const contentHtml = row.posts.find(
    (candidate) => candidate.slug === slug
  )?.contentHtml;
  if (!summary || contentHtml === undefined) return undefined;

  return {
    post: { ...summary, contentHtml },
    more: posts.filter((candidate) => candidate.id !== summary.id).slice(0, 3),
  };
}
