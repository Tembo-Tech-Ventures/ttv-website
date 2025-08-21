/**
 * Public blog listing page. Fetches posts from the database and renders links
 * to individual articles.
 */

import Link from "next/link";
import { getPosts } from "@/modules/blog/lib/get-posts/get-posts";

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
