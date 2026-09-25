import type { APIRoute } from "astro";
import { drizzle } from "drizzle-orm/d1";
import { env } from "cloudflare:workers";
import * as schema from "@/lib/db/schema";
import { postPath } from "@/lib/blog/feed";
import { listPublicPosts, listPublicProfiles } from "@/lib/blog/public";
import {
  buildSitemapXml,
  STATIC_PUBLIC_ROUTES,
  type SitemapEntry,
} from "@/lib/seo/sitemap";

export const GET: APIRoute = async ({ site }) => {
  const db = drizzle(env.DB, { schema });
  const [profiles, posts] = await Promise.all([
    listPublicProfiles(db),
    listPublicPosts(db),
  ]);

  const entries: SitemapEntry[] = [
    ...STATIC_PUBLIC_ROUTES.map((path) => ({ path })),
    ...profiles.map((profile) => ({
      path: `/talent/${profile.handle}`,
      lastmod: profile.updatedAt,
    })),
    ...posts.map((post) => ({
      path: postPath(post.profile.handle, post.slug),
      lastmod: post.updatedAt,
    })),
  ];

  const origin = site?.origin ?? "https://tembotechventures.com";
  return new Response(buildSitemapXml(origin, entries), {
    status: 200,
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
    },
  });
};
