import { z } from "zod";
import { CreateAccessRequest, type AccessRole } from "../contracts";

/**
 * Unsent access-request text (SPEC S2). It lives in sessionStorage only, never localStorage, so it ends
 * with the tab. It is cleared after a successful send and on sign-out.
 */
export const ONBOARDING_DRAFT_PREFIX = "ttv-onboarding-drafts:";
const MAX_FIELD = 4_096;
const MAX_STORED = 32_768;

export interface MentorDraft { note: string; link: string }
export interface InstitutionDraft {
  note: string; organisation: string; organisationRole: string; link: string; scopeAcknowledged: boolean;
}
export interface AccessRequestDrafts { MENTOR?: MentorDraft; INSTITUTION?: InstitutionDraft }
export type DraftFor<R extends AccessRole> = NonNullable<AccessRequestDrafts[R]>;
export type DraftField = keyof MentorDraft | keyof InstitutionDraft;
export type DraftFieldErrors = Partial<Record<DraftField, string>>;
/** The parts of Web Storage drafts use. Inject one in tests; the default is `window.sessionStorage`. */
export type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

// In-progress text may be invalid, but stored data is still bounded and stripped of unknown keys.
const Field = z.string().max(MAX_FIELD);
const StoredDrafts = z.object({
  MENTOR: z.object({ note: Field, link: Field }).optional(),
  INSTITUTION: z.object({
    note: Field, organisation: Field, organisationRole: Field, link: Field, scopeAcknowledged: z.boolean(),
  }).optional(),
});

export const EMPTY_DRAFTS: { readonly [R in AccessRole]: DraftFor<R> } = {
  MENTOR: { note: "", link: "" },
  INSTITUTION: { note: "", organisation: "", organisationRole: "", link: "", scopeAcknowledged: false },
};

/** SSR-safe and failure-tolerant: blocked storage (private modes, sandboxed frames) means no drafts. */
export function sessionDraftStorage(): DraftStorage | undefined {
  try { return typeof window === "undefined" ? undefined : window.sessionStorage; }
  catch { return undefined; }
}

/** One key per signed-in user, so a second account in the same tab never sees the first one's text. */
export function onboardingDraftKey(userId: string): string {
  return `${ONBOARDING_DRAFT_PREFIX}${userId}`;
}

export function readDrafts(storage: DraftStorage | undefined, key: string): AccessRequestDrafts {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return {};
    // Reject oversized or corrupt data before parsing it, and drop it so it can't linger.
    const parsed = raw.length <= MAX_STORED ? StoredDrafts.safeParse(JSON.parse(raw)) : undefined;
    if (parsed?.success) return parsed.data;
  } catch { /* Corrupt JSON is removed below. */ }
  try { storage?.removeItem(key); } catch { /* Storage is optional. */ }
  return {};
}

/** Returns false when the browser refused the write; the in-memory draft still works. */
export function writeDrafts(storage: DraftStorage | undefined, key: string, drafts: AccessRequestDrafts): boolean {
  if (!storage) return false;
  try {
    if (!drafts.MENTOR && !drafts.INSTITUTION) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify(StoredDrafts.parse(drafts)));
    return true;
  } catch { return false; }
}

/** Call from the sign-out flow: removes every user's onboarding drafts from this tab. */
export function clearOnboardingDrafts(storage: DraftStorage | undefined = sessionDraftStorage()): void {
  if (!storage) return;
  try {
    const keys: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const key = storage.key(i);
      if (key?.startsWith(ONBOARDING_DRAFT_PREFIX)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  } catch { /* Storage is optional. */ }
}

/** Bounded patch: unknown keys and over-long text never reach state or storage. */
export function patchDraft<R extends AccessRole>(role: R, current: DraftFor<R> | undefined, patch: Partial<DraftFor<R>>): DraftFor<R> {
  const next: Record<string, string | boolean> = { ...EMPTY_DRAFTS[role], ...current };
  for (const [field, value] of Object.entries(patch)) {
    if (!Object.hasOwn(next, field)) continue;
    if (typeof next[field] === "boolean" && typeof value === "boolean") next[field] = value;
    if (typeof next[field] === "string" && typeof value === "string") next[field] = value.slice(0, MAX_FIELD);
  }
  return next as unknown as DraftFor<R>;
}

const optional = (value: string) => value.trim() === "" ? null : value.trim();

export type DraftValidation =
  | { ok: true; body: CreateAccessRequest }
  | { ok: false; fieldErrors: DraftFieldErrors };

function requestBody(role: AccessRole, drafts: AccessRequestDrafts) {
  if (role === "MENTOR") {
    const { note, link } = { ...EMPTY_DRAFTS.MENTOR, ...drafts.MENTOR };
    return { role, note: note.trim(), link: optional(link) };
  }
  const { note, organisation, organisationRole, link, scopeAcknowledged } = { ...EMPTY_DRAFTS.INSTITUTION, ...drafts.INSTITUTION };
  return {
    role, note: note.trim(), organisation: organisation.trim(), organisationRole: optional(organisationRole),
    link: optional(link), scopeAcknowledged,
  };
}

/** Validates locally with the shared contract, so an invalid request never reaches the network. */
export function toCreateAccessRequest(role: AccessRole, drafts: AccessRequestDrafts): DraftValidation {
  const body = requestBody(role, drafts);
  const result = CreateAccessRequest.safeParse(body);
  if (result.success) return { ok: true, body: result.data };
  const fieldErrors: DraftFieldErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0] as DraftField;
    fieldErrors[field] ??= issue.message;
  }
  return { ok: false, fieldErrors };
}
