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
import { Container, Stack, Typography } from "@mui/material";

export const dynamic = "force-dynamic";

export default async function BlogIndex() {
  const posts = await getPosts();
  return (
    <Container sx={{ py: 4 }}>
      <Stack spacing={3} alignItems="center">
        <Typography variant="h3" color="orange.main">
          Blog
        </Typography>
        <Stack spacing={4} sx={{ width: "100%" }}>
          {posts.map((p) => (
            <Link
              key={p.slug}
              href={`/blog/${p.slug}`}
              style={{ textDecoration: "none" }}
            >
              <Stack spacing={1}>
                <Typography variant="h5" color="white">
                  {p.title}
                </Typography>
                <Typography color="white" variant="body2">
                  {p.content.slice(0, 120)}...
                </Typography>
              </Stack>
            </Link>
          ))}
        </Stack>
      </Stack>
    </Container>
  );
}
