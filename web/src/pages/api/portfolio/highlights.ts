import type { APIRoute } from "astro";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import { and, eq } from "drizzle-orm";
import { env } from "cloudflare:workers";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import {
  fetchPublicRepos,
  toHighlightSnapshot,
  GitHubAuthError,
} from "@/lib/talent/github";
import { createAuth } from "@/lib/auth";
import { parseSkillsJson } from "@/lib/talent/profile";
import { isAgentSession } from "@/lib/agent-auth";
import { loadProfilePhotoForModeration } from "@/lib/avatar";
import {
  checkProfileContent,
  previewProfileModerationResult,
  profileModerationMessages,
  PROFILE_MODERATION_PREVIEW_HEADER,
} from "@/lib/moderation/clef";
import {
  profileStateWithHighlights,
  replaceProfileHighlights,
  type HighlightProfileState,
  type ProfileHighlightValues,
} from "@/lib/talent/profile-highlights";

const highlightEntrySchema = z.object({
  repoFullName: z.string().min(1).max(200),
  blurb: z.string().max(500).default(""),
  sortOrder: z.number().int().min(0).max(5),
});

export const highlightsBodySchema = z.array(highlightEntrySchema).max(6);

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function getSession(request: Request) {
  const auth = createAuth(env);
  return auth.api.getSession({ headers: request.headers });
}

async function getUserProfile(db: Database, userId: string) {
  return db.query.studentProfile.findFirst({
    where: eq(schema.studentProfile.userId, userId),
    with: {
      user: { columns: { name: true, image: true } },
      highlights: {
        orderBy: (highlight, { asc }) => [asc(highlight.sortOrder)],
      },
    },
  });
}

async function getGitHubToken(
  db: Database,
  userId: string,
): Promise<string | null> {
  const ghAccount = await db.query.account.findFirst({
    where: and(
      eq(schema.account.userId, userId),
      eq(schema.account.providerId, "github"),
    ),
    columns: { accessToken: true },
  });
  return ghAccount?.accessToken ?? null;
}

function toStoredHighlights(
  entries: z.infer<typeof highlightsBodySchema>,
  repos: Awaited<ReturnType<typeof fetchPublicRepos>>,
): ProfileHighlightValues[] {
  const repoMap = new Map(repos.map((repo) => [repo.full_name, repo]));
  return entries.map((entry) => {
    const repo = repoMap.get(entry.repoFullName);
    if (!repo) throw new Error("Unknown repository");
    return {
      ...toHighlightSnapshot(repo),
      blurb: entry.blurb || null,
      sortOrder: entry.sortOrder,
    };
  });
}

async function moderateHighlights(
  request: Request,
  sessionUserAgent: string | null | undefined,
  profile: HighlightProfileState,
  highlights: readonly ProfileHighlightValues[],
) {
  const previewResult = previewProfileModerationResult(
    env.DEPLOYMENT_ENVIRONMENT,
    isAgentSession(sessionUserAgent),
    request.headers.get(PROFILE_MODERATION_PREVIEW_HEADER),
  );
  if (previewResult) return previewResult;

  const avatarUrl = profile.publicAvatarUrl ?? profile.user.image;
  return checkProfileContent(
    env.AI,
    profileStateWithHighlights(
      profile,
      parseSkillsJson(profile.skills),
      highlights,
    ),
    {
      gatewayName: env.AI_GATEWAY_NAME,
      loadAvatarImage: avatarUrl
        ? () => loadProfilePhotoForModeration(env.BUCKET, avatarUrl)
        : undefined,
    },
  );
}

async function persistHighlights(
  request: Request,
  db: Database,
  profile: HighlightProfileState,
  sessionUserAgent: string | null | undefined,
  highlights: readonly ProfileHighlightValues[],
): Promise<Response | null> {
  const moderation =
    profile.status === "PUBLISHED"
      ? await moderateHighlights(request, sessionUserAgent, profile, highlights)
      : undefined;
  const result = await replaceProfileHighlights(
    db,
    profile,
    highlights,
    moderation,
  );

  if (result.outcome === "suspended") {
    return jsonResponse({ error: "A paused profile cannot be edited." }, 409);
  }
  if (result.outcome === "conflict") {
    return jsonResponse(
      {
        error:
          "This profile changed while your request was running. Reload and try again.",
      },
      409,
    );
  }
  if (result.outcome === "hold" && moderation) {
    return jsonResponse(
      {
        error: "Your changes need attention before they can go live.",
        moderationMessages: profileModerationMessages(moderation.flags),
      },
      422,
    );
  }
  return null;
}

export const POST: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user) return jsonResponse({ error: "unauthorized" }, 401);

  const db = drizzle(env.DB, { schema });
  const profile = await getUserProfile(db, session.user.id);
  if (!profile) return jsonResponse({ error: "Profile not found" }, 400);
  if (profile.status === "SUSPENDED") {
    return jsonResponse({ error: "A paused profile cannot be edited." }, 409);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON" }, 400);
  }

  const parsed = highlightsBodySchema.safeParse(body);
  if (!parsed.success) {
    return jsonResponse(
      { error: "Validation failed", details: parsed.error.flatten() },
      400,
    );
  }

  let rows: ProfileHighlightValues[] = [];
  if (parsed.data.length > 0) {
    const accessToken = await getGitHubToken(db, session.user.id);
    if (!accessToken) {
      return jsonResponse({ error: "GitHub account not connected" }, 400);
    }

    let repos;
    try {
      repos = await fetchPublicRepos(accessToken);
    } catch (error) {
      if (error instanceof GitHubAuthError) {
        return jsonResponse({ error: "auth_error" }, 400);
      }
      return jsonResponse({ error: "Failed to fetch GitHub repos" }, 500);
    }

    const repoNames = new Set(repos.map((repo) => repo.full_name));
    const unknownRepos = parsed.data.filter(
      (entry) => !repoNames.has(entry.repoFullName),
    );
    if (unknownRepos.length > 0) {
      return jsonResponse(
        {
          error: `Unknown repositories: ${unknownRepos.map((entry) => entry.repoFullName).join(", ")}`,
        },
        400,
      );
    }
    rows = toStoredHighlights(parsed.data, repos);
  }

  const errorResponse = await persistHighlights(
    request,
    db,
    profile,
    session.session?.userAgent,
    rows,
  );
  return errorResponse ?? jsonResponse({ ok: true });
};

export const PUT: APIRoute = async ({ request }) => {
  const session = await getSession(request);
  if (!session?.user) return jsonResponse({ error: "unauthorized" }, 401);

  const db = drizzle(env.DB, { schema });
  const profile = await getUserProfile(db, session.user.id);
  if (!profile) return jsonResponse({ error: "Profile not found" }, 400);
  if (profile.status === "SUSPENDED") {
    return jsonResponse({ error: "A paused profile cannot be edited." }, 409);
  }
  if (profile.highlights.length === 0) {
    return jsonResponse({ ok: true, refreshed: 0 });
  }

  const accessToken = await getGitHubToken(db, session.user.id);
  if (!accessToken) {
    return jsonResponse({ error: "GitHub account not connected" }, 400);
  }

  let repos;
  try {
    repos = await fetchPublicRepos(accessToken);
  } catch (error) {
    if (error instanceof GitHubAuthError) {
      return jsonResponse({ error: "auth_error" }, 400);
    }
    return jsonResponse({ error: "Failed to fetch GitHub repos" }, 500);
  }

  const repoMap = new Map(repos.map((repo) => [repo.full_name, repo]));
  let refreshed = 0;
  const rows: ProfileHighlightValues[] = profile.highlights.map((highlight) => {
    const repo = repoMap.get(highlight.repoFullName);
    if (!repo) {
      return {
        repoFullName: highlight.repoFullName,
        repoUrl: highlight.repoUrl,
        description: highlight.description,
        language: highlight.language,
        topics: highlight.topics ?? "[]",
        stars: highlight.stars,
        pushedAt: highlight.pushedAt,
        blurb: highlight.blurb,
        sortOrder: highlight.sortOrder,
        snapshotAt: highlight.snapshotAt,
      };
    }
    refreshed += 1;
    return {
      ...toHighlightSnapshot(repo),
      blurb: highlight.blurb,
      sortOrder: highlight.sortOrder,
    };
  });

  if (refreshed === 0) {
    return jsonResponse({ ok: true, refreshed: 0 });
  }

  const errorResponse = await persistHighlights(
    request,
    db,
    profile,
    session.session?.userAgent,
    rows,
  );
  return errorResponse ?? jsonResponse({ ok: true, refreshed });
};
