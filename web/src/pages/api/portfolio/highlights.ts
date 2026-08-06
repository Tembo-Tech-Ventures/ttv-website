import type { APIRoute } from "astro";
import { z } from "zod";
import { drizzle } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import { env } from "cloudflare:workers";
import * as schema from "@/lib/db/schema";
import type { Database } from "@/lib/db/schema";
import {
  fetchPublicRepos,
  toHighlightSnapshot,
  GitHubAuthError,
} from "@/lib/talent/github";
import { createAuth } from "@/lib/auth";

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

async function getSessionUser(request: Request) {
  const auth = createAuth(env);
  const session = await auth.api.getSession({ headers: request.headers });
  return session?.user ?? null;
}

async function getUserProfile(db: Database, userId: string) {
  return db.query.studentProfile.findFirst({
    where: eq(schema.studentProfile.userId, userId),
    columns: { id: true },
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

export const POST: APIRoute = async ({ request }) => {
  const user = await getSessionUser(request);
  if (!user) return jsonResponse({ error: "unauthorized" }, 401);

  const db = drizzle(env.DB, { schema });
  const profile = await getUserProfile(db, user.id);
  if (!profile) return jsonResponse({ error: "Profile not found" }, 400);

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

  const entries = parsed.data;
  if (entries.length === 0) {
    await db
      .delete(schema.profileHighlight)
      .where(eq(schema.profileHighlight.profileId, profile.id));
    return jsonResponse({ ok: true });
  }

  const accessToken = await getGitHubToken(db, user.id);
  if (!accessToken) {
    return jsonResponse({ error: "GitHub account not connected" }, 400);
  }

  let repos;
  try {
    repos = await fetchPublicRepos(accessToken);
  } catch (err) {
    if (err instanceof GitHubAuthError) {
      return jsonResponse({ error: "auth_error" }, 400);
    }
    return jsonResponse({ error: "Failed to fetch GitHub repos" }, 500);
  }

  const repoMap = new Map(repos.map((r) => [r.full_name, r]));
  const unknownRepos = entries.filter((e) => !repoMap.has(e.repoFullName));
  if (unknownRepos.length > 0) {
    return jsonResponse(
      {
        error: `Unknown repositories: ${unknownRepos.map((r) => r.repoFullName).join(", ")}`,
      },
      400,
    );
  }

  await db
    .delete(schema.profileHighlight)
    .where(eq(schema.profileHighlight.profileId, profile.id));

  const rows = entries.map((entry) => {
    const repo = repoMap.get(entry.repoFullName)!;
    const snapshot = toHighlightSnapshot(repo);
    return {
      profileId: profile.id,
      repoFullName: snapshot.repoFullName,
      repoUrl: snapshot.repoUrl,
      description: snapshot.description,
      language: snapshot.language,
      topics: snapshot.topics,
      stars: snapshot.stars,
      pushedAt: snapshot.pushedAt,
      blurb: entry.blurb || null,
      sortOrder: entry.sortOrder,
      snapshotAt: snapshot.snapshotAt,
    };
  });

  await db.insert(schema.profileHighlight).values(rows);

  return jsonResponse({ ok: true });
};

export const PUT: APIRoute = async ({ request }) => {
  const user = await getSessionUser(request);
  if (!user) return jsonResponse({ error: "unauthorized" }, 401);

  const db = drizzle(env.DB, { schema });
  const profile = await getUserProfile(db, user.id);
  if (!profile) return jsonResponse({ error: "Profile not found" }, 400);

  const existing = await db.query.profileHighlight.findMany({
    where: eq(schema.profileHighlight.profileId, profile.id),
  });

  if (existing.length === 0) {
    return jsonResponse({ ok: true, refreshed: 0 });
  }

  const accessToken = await getGitHubToken(db, user.id);
  if (!accessToken) {
    return jsonResponse({ error: "GitHub account not connected" }, 400);
  }

  let repos;
  try {
    repos = await fetchPublicRepos(accessToken);
  } catch (err) {
    if (err instanceof GitHubAuthError) {
      return jsonResponse({ error: "auth_error" }, 400);
    }
    return jsonResponse({ error: "Failed to fetch GitHub repos" }, 500);
  }

  const repoMap = new Map(repos.map((r) => [r.full_name, r]));

  await db
    .delete(schema.profileHighlight)
    .where(eq(schema.profileHighlight.profileId, profile.id));

  const refreshed = existing
    .filter((h) => repoMap.has(h.repoFullName))
    .map((h) => {
      const repo = repoMap.get(h.repoFullName)!;
      const snapshot = toHighlightSnapshot(repo);
      return {
        profileId: profile.id,
        repoFullName: snapshot.repoFullName,
        repoUrl: snapshot.repoUrl,
        description: snapshot.description,
        language: snapshot.language,
        topics: snapshot.topics,
        stars: snapshot.stars,
        pushedAt: snapshot.pushedAt,
        blurb: h.blurb,
        sortOrder: h.sortOrder,
        snapshotAt: snapshot.snapshotAt,
      };
    });

  if (refreshed.length > 0) {
    await db.insert(schema.profileHighlight).values(refreshed);
  }

  return jsonResponse({ ok: true, refreshed: refreshed.length });
};
