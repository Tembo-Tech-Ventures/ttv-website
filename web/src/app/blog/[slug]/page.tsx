/**
 * Renders a single blog post retrieved from the database.
 */

import { getPost } from "@/modules/blog/lib/get-post/get-post";
import Markdown from "react-markdown";

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
