export function postPath(handle: string, slug: string): string {
  return `/blog/${handle}/${slug}`;
}

export function canonicalPostUrl(
  siteOrigin: string,
  handle: string,
  slug: string
): string {
  return `${siteOrigin}${postPath(handle, slug)}`;
}

export interface FeedItem {
  title: string;
  path: string;
  excerpt: string | null;
  authorName: string;
  authorHandle: string;
  publishedAt: Date;
  readingMinutes: number;
  coverImageKey: string | null;
  coverImageAlt: string | null;
}

export function toFeedItem(post: {
  title: string;
  slug: string;
  excerpt: string | null;
  readingMinutes: number;
  publishedAt: Date;
  coverImageKey: string | null;
  coverImageAlt: string | null;
  profile: {
    handle: string;
    user: { name: string };
  };
}): FeedItem {
  return {
    title: post.title,
    path: postPath(post.profile.handle, post.slug),
    excerpt: post.excerpt,
    authorName: post.profile.user.name,
    authorHandle: post.profile.handle,
    publishedAt: post.publishedAt,
    readingMinutes: post.readingMinutes,
    coverImageKey: post.coverImageKey,
    coverImageAlt: post.coverImageAlt,
  };
}
