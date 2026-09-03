import { z } from "zod";

const MAX_CONTENT_LENGTH = 40_000;
const MAX_TITLE_LENGTH = 200;
const MAX_EXCERPT_LENGTH = 300;

export const WORDS_PER_MINUTE = 200;

export const postEditorSchema = z.object({
  title: z
    .string()
    .min(1, "Title is required")
    .max(MAX_TITLE_LENGTH, `Title cannot exceed ${MAX_TITLE_LENGTH} characters`),
  slug: z.string().optional(),
  contentMarkdown: z
    .string()
    .min(1, "Content is required")
    .max(
      MAX_CONTENT_LENGTH,
      `Content cannot exceed ${MAX_CONTENT_LENGTH} characters`
    ),
  excerpt: z.string().max(MAX_EXCERPT_LENGTH).optional(),
  coverImageAlt: z.string().max(200).optional(),
});

export function deriveExcerpt(markdown: string, maxLength = 160): string {
  const plain = markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/_([^_]+)_/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/^\s*[-*+]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/^\s*>\s+/gm, "")
    .replace(/\n{2,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!plain) return "";
  if (plain.length <= maxLength) return plain;

  const clipped = plain.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(" ");
  const base = lastSpace > 0 ? clipped.slice(0, lastSpace) : clipped;
  return `${base.replace(/[.,;:!?-]+$/, "")}…`;
}

export function estimateReadingMinutes(markdown: string): number {
  const words = markdown
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  return Math.max(1, Math.ceil(words / WORDS_PER_MINUTE));
}
