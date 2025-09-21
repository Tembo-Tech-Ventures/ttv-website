/**
 * get-posts.ts
 * -------------
 * Retrieves blog posts from the database ordered by creation date. Keeping the
 * query logic in this utility allows pages and API routes to stay focused on
 * rendering concerns.
 */

import { prisma } from "@/modules/prisma/lib/prisma-client/prisma-client";

export interface BlogPost {
  id: string;
  slug: string;
  title: string;
  content: string;
  createdAt: Date;
  updatedAt: Date;
}

export async function getPosts(): Promise<BlogPost[]> {
  return prisma.blogPost.findMany({ orderBy: { createdAt: "desc" } });
}
