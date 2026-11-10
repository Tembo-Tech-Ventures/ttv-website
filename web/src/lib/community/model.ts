import { z } from "zod";
import { WorkStatus, type WorkKind } from "@/lib/platform/contracts";

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
const journeyFields = z.object({
  title: z.string().trim().min(1).max(160),
  description: z.string().trim().min(1).max(6000),
  evidenceUrl: safeUrl.nullable().optional(),
  occurredAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
    const d = new Date(s); return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Use a valid calendar date."),
  status: WorkStatus.default("posted"),
}).strict();
/** Deprecated audience inputs are accepted only here; responses use status exclusively. */
function legacyWorkStatus(input: unknown): unknown {
  if (!input || typeof input !== "object" || Array.isArray(input)) return input;
  const value = { ...input } as Record<string, unknown>;
  if (!("visibility" in value) || "status" in value) return value;
  if (value.visibility !== "private" && value.visibility !== "institution") return value;
  value.status = value.visibility === "private" ? "draft" : "posted";
  delete value.visibility;
  return value;
}
export const journeyInput = z.preprocess(legacyWorkStatus, journeyFields);
export const journeyUpdateInput = z.preprocess(legacyWorkStatus, journeyFields.extend({ expectedRevision: z.number().int().positive().optional() }));
export const journeyStatusInput = z.preprocess(legacyWorkStatus, z.object({ status: WorkStatus }).strict());
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
  moderationHold?:boolean;
  userId: string; name: string; image: string | null; version: number; updatedAt: number | null;
}
export interface CommunityConfirmation {
  id: string; journeyId: string; mentorId: string; mentorName: string;
  statement: string; method: string; journeyVersion: number; mentorRole: "MENTOR" | "ADMIN" | "UNKNOWN"; createdAt: number;
}
export interface CommunityJourney extends CommunityJourneyInput {
  kind:WorkKind;
  repoFullName:string|null;
  moderationHold?: boolean;
  moderatorHidden?: boolean;
  id: string; userId: string; version: number; createdAt: number; updatedAt: number;
  confirmations: CommunityConfirmation[];
}

/** The wire contract is lowercase; the additive D1 storage uses uppercase state. */
export function workState(status:"posted"|"draft"):"POSTED"|"DRAFT" {
  return status === "draft" ? "DRAFT" : "POSTED";
}
/** Canonical storage-to-wire projection for SQL reads. Callers supply only internal column names. */
export function workStatusSql(column = "state"): string {
  if (!/^[a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)?$/.test(column))
    throw new Error("Invalid work state column.");
  return `CASE WHEN ${column}='POSTED' THEN 'posted' ELSE 'draft' END`;
}
