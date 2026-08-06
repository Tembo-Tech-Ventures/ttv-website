import type { APIRoute } from "astro";
import { drizzle } from "drizzle-orm/d1";
import { eq, and } from "drizzle-orm";
import { env } from "cloudflare:workers";
import * as schema from "@/lib/db/schema";
import { fetchPublicRepos, GitHubAuthError } from "@/lib/talent/github";
import { createAuth } from "@/lib/auth";

export const GET: APIRoute = async ({ request }) => {
  const auth = createAuth(env);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session?.user) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const db = drizzle(env.DB, { schema });
  const ghAccount = await db.query.account.findFirst({
    where: and(
      eq(schema.account.userId, session.user.id),
      eq(schema.account.providerId, "github"),
    ),
    columns: { accessToken: true },
  });

  if (!ghAccount?.accessToken) {
    return new Response(JSON.stringify({ error: "no_token" }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const repos = await fetchPublicRepos(ghAccount.accessToken);
    return new Response(
      JSON.stringify({
        repos: repos.map((r) => ({
          full_name: r.full_name,
          html_url: r.html_url,
          description: r.description,
          language: r.language,
          stargazers_count: r.stargazers_count,
          topics: r.topics,
          pushed_at: r.pushed_at,
        })),
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    if (err instanceof GitHubAuthError) {
      return new Response(JSON.stringify({ error: "auth_error" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response(
      JSON.stringify({ error: "Failed to fetch repositories" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
};
