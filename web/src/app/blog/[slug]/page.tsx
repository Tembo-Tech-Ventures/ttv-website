/**
 * BlogPost
 * --------
 * Displays a single blog entry. Similar to the index page, this component is
 * flagged `force-dynamic` so that the database query only occurs at request
 * time. Without this, a static export would attempt to resolve the dynamic
 * route at build time and fail if the database is unreachable.
 */

import { getPost } from "@/modules/blog/lib/get-post/get-post";
import Markdown from "react-markdown";

export const dynamic = "force-dynamic";

interface Params {
  params: { slug: string };
}

export default async function BlogPost({ params }: Params) {
  const post = await getPost(params.slug);
  if (!post) {
    return <p>Post not found</p>;
  }
  return (
    <article>
      <h1>{post.title}</h1>
      <Markdown>{post.content}</Markdown>
    </article>
  );
}
