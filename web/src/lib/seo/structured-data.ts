import { normalizeDescription, SITE_NAME } from "@/lib/seo";

export interface PersonJsonLdInput {
  name: string;
  url: string;
  image?: string | null;
  headline?: string | null;
  description?: string | null;
  sameAs?: Array<string | null | undefined>;
}

export interface ArticleJsonLdInput {
  title: string;
  url: string;
  description?: string | null;
  publishedAt: Date;
  updatedAt: Date;
  author: PersonJsonLdInput;
  image?: string | null;
  siteOrigin: string;
}

export function buildPersonJsonLd(input: PersonJsonLdInput) {
  const description = normalizeDescription(input.description ?? undefined);
  const sameAs = (input.sameAs ?? []).filter(
    (url): url is string => typeof url === "string" && url.length > 0
  );

  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: input.name,
    url: input.url,
    ...(input.image ? { image: input.image } : {}),
    ...(input.headline ? { jobTitle: input.headline } : {}),
    ...(description ? { description } : {}),
    ...(sameAs.length > 0 ? { sameAs } : {}),
  };
}

export function buildArticleJsonLd(input: ArticleJsonLdInput) {
  const description = normalizeDescription(input.description ?? undefined);
  const author = buildPersonJsonLd(input.author);
  const { "@context": _context, ...authorWithoutContext } = author;

  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.title,
    mainEntityOfPage: input.url,
    url: input.url,
    datePublished: input.publishedAt.toISOString(),
    dateModified: input.updatedAt.toISOString(),
    ...(description ? { description } : {}),
    ...(input.image ? { image: input.image } : {}),
    author: authorWithoutContext,
    publisher: {
      "@type": "Organization",
      name: SITE_NAME,
      url: input.siteOrigin,
      logo: {
        "@type": "ImageObject",
        url: new URL("/og-default.png", input.siteOrigin).toString(),
      },
    },
  };
}

/** Prevent a title containing `</script>` from escaping the JSON-LD element. */
export function serializeJsonLd(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}
