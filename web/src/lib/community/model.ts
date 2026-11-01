import { z } from "zod";

export class CommunityError extends Error {
  constructor(message: string, public readonly status = 400) { super(message); }
}

const safeUrl = z.string().url().max(2000).refine((value) => {
  const url = new URL(value);
  // Links are displayed, never fetched. Credentials and private app routes are excluded.
  return url.protocol === "https:" && !url.username && !url.password &&
    !/^\/(?:admin|api|dashboard)(?:\/|$)/i.test(url.pathname);
}, "Use a public HTTPS evidence link without credentials.");

export const profileInput = z.object({
  headline: z.string().trim().max(160),
  bio: z.string().trim().max(4000),
  skills: z.array(z.string().trim().min(1).max(60)).max(30),
  opportunityGoals: z.string().trim().max(2000),
}).strict();
export const journeyInput = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(6000),
  evidenceUrl: safeUrl.nullable().optional(),
  occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
    const d = new Date(s); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Use a valid calendar date."),
  // "private" is an unpublished draft, never an institutional discovery opt-out.
  visibility: z.enum(["institution", "private"]),
}).strict();
export const journeyUpdateInput = journeyInput.extend({ expectedRevision: z.number().int().positive().optional() });
export const confirmationInput = z.object({
  expectedRevision: z.number().int().positive(),
  statement: z.string().trim().min(10).max(2000),
  method: z.string().trim().min(3).max(500),
}).strict();
/** Setting aside names the revision the mentor saw; a newer one waits again. */
export const setAsideInput = z.object({
  expectedRevision: z.number().int().positive(),
}).strict();
export const searchInput = z.object({
  skills: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  query: z.string().trim().max(200).default(""),
  limit: z.number().int().min(1).max(50).default(20),
}).strict();

export function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) throw new CommunityError(result.error.issues.map((i) => i.message).join(" "));
  return result.data;
}
export type CommunityProfileInput = z.infer<typeof profileInput>;
export type CommunityJourneyInput = z.infer<typeof journeyInput>;
export interface CommunityProfile extends CommunityProfileInput {
  userId: string; name: string; image: string | null; version: number; updatedAt: number | null;
}
export interface CommunityConfirmation {
  id: string; journeyId: string; mentorId: string; mentorName: string;
  statement: string; method: string; journeyVersion: number; mentorRole: "MENTOR" | "ADMIN" | "UNKNOWN"; createdAt: number;
}
export interface CommunityJourney extends CommunityJourneyInput {
  id: string; userId: string; version: number; createdAt: number; updatedAt: number;
  confirmations: CommunityConfirmation[];
}
