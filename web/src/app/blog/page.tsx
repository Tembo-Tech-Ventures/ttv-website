/**
 * BlogIndex
 * ---------
 * Server component that lists published blog posts. The page is marked as
 * `force-dynamic` so Next.js renders it at request time instead of during the
 * build. This avoids build failures when the database is unavailable (such as
 * in CI) while still serving fresh content in production.
 */

import Link from "next/link";
import { getPosts } from "@/modules/blog/lib/get-posts/get-posts";

export const dynamic = "force-dynamic";

export default async function BlogIndex() {
  const posts = await getPosts();
  return (
    <ul>
      {posts.map((p) => (
        <li key={p.slug}>
          <Link href={`/blog/${p.slug}`}>{p.title}</Link>
        </li>
      ))}
    </ul>
  );
}
