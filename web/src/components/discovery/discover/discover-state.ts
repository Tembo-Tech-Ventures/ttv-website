import { boundedForm } from "@/components/platform/onboarding/welcome-flow";
import { isSameOriginRequest } from "@/lib/agent-auth";
import { SPACE_PATHS } from "@/lib/platform/server/space-routes";
import { assessProfile } from "@/components/community/assessment-client";
import { assessmentRubricSchema, type EvidenceAssessment } from "@/components/community/assessment-contract";
import { askProfile, discoverPeople, loadAccess, loadProfile, searchProfiles } from "@/components/community/community-client";
import type { CommunityProfile, EvidenceAnswer, ScoutCriteria } from "../types";
import { UiApiError } from "../ui-errors";

/**
 * Discover (/dashboard/discover) without an island: what each request asks
 * for, and what the page shows for it. Every read and write goes through the
 * community client with an in-process fetch (lib/community/in-process.ts), so
 * the client's checks and the API's sign-in, origin, scope and institution
 * checks are those of the island it replaces.
 *
 * The opportunity description can be confidential, so it never enters an
 * address: scouting by criteria, opening a person from those results, asking
 * about their work and assessing it are POSTs that carry it in hidden fields.
 * A name lookup and a profile link are GETs, as their addresses already were
 * (`?lookup=1&scout=results&query=…`, `?profile=…`).
 */
export const DISCOVER_PATH = SPACE_PATHS.discover;

export const CONTEXT_MAX = 4000;
export const SKILLS_TEXT_MAX = 300;
export const QUERY_MAX = 200;
export const QUESTION_MAX = 2000;
export const MAX_SKILLS = 10;
export const MAX_CRITERIA = 10;
const LABEL_MAX = 200;
const TERMS_TEXT_MAX = 818;

/** What a search was, carried from page to page so "Back to people" can run it again. */
export interface Carried {
  context: string;
  skills: string;
  query: string;
  /** A name lookup rather than scouting by criteria. */
  lookup: boolean;
}
export const NO_SEARCH: Carried = { context: "", skills: "", query: "", lookup: false };

export interface CriterionRow {
  label: string;
  terms: string;
}

export type DiscoverRequest =
  | { kind: "criteria"; carried: Carried }
  | { kind: "search"; carried: Carried }
  | { kind: "profile"; id: string; carried: Carried; question?: string; rows?: CriterionRow[]; assess?: boolean };

const text = (value: unknown, max: number) => (typeof value === "string" ? value.slice(0, max) : "");

/** A GET: a fresh form, a lookup's results, or a profile link. Older scouting links still open. */
export function readDiscoverGet(url: URL): DiscoverRequest {
  const params = url.searchParams;
  const carried: Carried = {
    context: "",
    skills: text(params.get("skills"), SKILLS_TEXT_MAX),
    query: text(params.get("query"), QUERY_MAX),
    lookup: params.get("lookup") === "1",
  };
  const profile = text(params.get("profile"), 200).trim();
  if (profile) return { kind: "profile", id: profile, carried };
  // A scouting search needs its opportunity, which never travels in an address: its form opens instead.
  if (carried.lookup && params.get("scout") === "results" && carried.query.trim()) return { kind: "search", carried };
  return { kind: "criteria", carried };
}

function carriedFrom(form: FormData): Carried {
  return {
    context: text(form.get("context"), CONTEXT_MAX),
    skills: text(form.get("skills"), SKILLS_TEXT_MAX),
    query: text(form.get("query"), QUERY_MAX),
    lookup: form.get("lookup") === "1",
  };
}

function rowsFrom(form: FormData): CriterionRow[] {
  const count = Math.min(Math.max(Number(form.get("rows")) || 1, 1), MAX_CRITERIA);
  const rows = Array.from({ length: count }, (_, index) => ({
    label: text(form.get(`label-${index}`), LABEL_MAX),
    terms: text(form.get(`terms-${index}`), TERMS_TEXT_MAX),
  }));
  const intent = text(form.get("intent"), 40);
  if (intent === "add-criterion" && rows.length < MAX_CRITERIA) rows.push({ label: "", terms: "" });
  const removed = /^remove-(\d+)$/.exec(intent);
  if (removed && rows.length > 1) rows.splice(Number(removed[1]), 1);
  return rows;
}

export type DiscoverPost = { ok: true; request: DiscoverRequest } | { ok: false; status: 400 | 403 | 413 };

/** A POST: scouting by criteria, back to its form, or a person opened, asked about or assessed. */
export async function readDiscoverPost(request: Request): Promise<DiscoverPost> {
  if (!isSameOriginRequest(request)) return { ok: false, status: 403 };
  const form = await boundedForm(request);
  if (!form) return { ok: false, status: 413 };
  const carried = carriedFrom(form);
  const kind = form.get("form");
  if (kind === "scout") return { ok: true, request: { kind: "search", carried: { ...carried, lookup: false } } };
  if (kind === "edit") return { ok: true, request: { kind: "criteria", carried } };
  const id = text(form.get("profile"), 200).trim();
  if (!id) return { ok: false, status: 400 };
  if (kind === "open") return { ok: true, request: { kind: "profile", id, carried } };
  // A suggested question is its own button, so it is asked as it is, whatever the field holds.
  if (kind === "ask") {
    const question = text(form.get("suggestion"), QUESTION_MAX) || text(form.get("question"), QUESTION_MAX);
    return { ok: true, request: { kind: "profile", id, carried, question } };
  }
  if (kind === "assess") {
    const intent = text(form.get("intent"), 40);
    return { ok: true, request: { kind: "profile", id, carried, rows: rowsFrom(form), assess: intent === "assess" || intent === "" } };
  }
  return { ok: false, status: 400 };
}

// ---- What the page shows ----------------------------------------------------

/** Why something could not be done, as the page's danger notice says it. */
export interface Problem {
  title: string;
  detail: string;
}

export type SearchErrors = Partial<Record<"context" | "skills" | "query", string>>;

export type DiscoverView =
  | { kind: "criteria"; carried: Carried; errors: SearchErrors; problem: Problem | null }
  | { kind: "results"; carried: Carried; profiles: CommunityProfile[] }
  | {
    kind: "profile";
    carried: Carried;
    profile: CommunityProfile;
    question: string;
    answer: EvidenceAnswer | null;
    askProblem: Problem | null;
    rows: CriterionRow[];
    rowsError: string | null;
    assessment: EvidenceAssessment | null;
    assessProblem: Problem | null;
  }
  | { kind: "unavailable"; carried: Carried; problem: Problem };

export interface DiscoverOutcome {
  status: number;
  view: DiscoverView;
}

const skillsOf = (value: string) => value.split(",").map((skill) => skill.trim()).filter(Boolean);
const criteriaOf = (carried: Carried): ScoutCriteria => ({ context: carried.context, skills: carried.skills, query: carried.query });

/** The status a failed call answers with: the API's refusal as it was, a server failure as 503. */
function statusOf(cause: unknown): number {
  if (!(cause instanceof UiApiError)) return 503;
  return cause.status >= 500 ? 503 : cause.status;
}
const problemOf = (title: string, cause: unknown, fallback: string): Problem =>
  ({ title, detail: cause instanceof UiApiError ? cause.message : fallback });

export function validateSearch(carried: Carried): SearchErrors {
  const errors: SearchErrors = {};
  if (carried.lookup) {
    if (!carried.query.trim()) errors.query = "Enter the name of the person you're looking for.";
    return errors;
  }
  if (skillsOf(carried.skills).length > MAX_SKILLS) errors.skills = `Explore up to ${MAX_SKILLS} skills at a time.`;
  if (!carried.context.trim() && !carried.skills.trim() && !carried.query.trim()) {
    errors.context = "Describe the opportunity or the skills you need.";
  }
  return errors;
}

/** The criteria as a rubric, or why they can't be one. */
function rubricOf(rows: readonly CriterionRow[]) {
  return assessmentRubricSchema.safeParse({
    id: "institution-ui",
    version: 1,
    criteria: rows.map((row, index) => ({
      id: `criterion-${index + 1}`,
      label: row.label,
      terms: skillsOf(row.terms),
      contraryTerms: [],
    })),
  });
}

const NEW_ROW: CriterionRow = { label: "", terms: "" };

/** Who may use Discover: approved institutions and admins, as the API decides. */
export async function discoverAccess(fetcher: typeof fetch): Promise<boolean | null> {
  try {
    const access = await loadAccess(fetcher);
    return access.isInstitution || access.isAdmin;
  } catch {
    return null;
  }
}

/** Runs what the request asks for, through the community client and `fetcher`. */
export async function runDiscover(request: DiscoverRequest, fetcher: typeof fetch): Promise<DiscoverOutcome> {
  const { carried } = request;
  if (request.kind === "criteria") return { status: 200, view: { kind: "criteria", carried, errors: {}, problem: null } };

  if (request.kind === "search") {
    const errors = validateSearch(carried);
    if (Object.keys(errors).length > 0) return { status: 400, view: { kind: "criteria", carried, errors, problem: null } };
    try {
      const profiles = carried.lookup
        ? await searchProfiles({ context: "", skills: "", query: carried.query.trim() }, fetcher)
        : await discoverPeople(criteriaOf(carried), fetcher);
      return { status: 200, view: { kind: "results", carried, profiles } };
    } catch (cause) {
      const problem = problemOf("Search could not be completed", cause, "Your criteria are still here; please try again.");
      return { status: statusOf(cause), view: { kind: "criteria", carried, errors: {}, problem } };
    }
  }

  let profile: CommunityProfile;
  try {
    profile = await loadProfile(request.id, fetcher);
  } catch (cause) {
    const problem = problemOf("This profile could not be opened", cause, "Please try again.");
    return { status: statusOf(cause), view: { kind: "unavailable", carried, problem } };
  }
  const base = {
    kind: "profile" as const, carried, profile, question: request.question ?? "", answer: null, askProblem: null,
    rows: request.rows ?? [NEW_ROW], rowsError: null, assessment: null, assessProblem: null,
  };

  if (request.question !== undefined) {
    const question = request.question.trim();
    if (!question) return { status: 400, view: { ...base, askProblem: { title: "Write a question first", detail: "Ask about this person's contributions or sources." } } };
    try {
      return { status: 200, view: { ...base, answer: await askProfile(profile, question, criteriaOf(carried), fetcher) } };
    } catch (cause) {
      const problem = problemOf("We couldn't answer that question", cause, "Your question is still here; please try again.");
      return { status: statusOf(cause), view: { ...base, askProblem: problem } };
    }
  }

  if (request.rows && request.assess) {
    const rubric = rubricOf(request.rows);
    if (!rubric.success) {
      const rowsError = "Add a label and 1–10 supporting terms for each criterion. Terms must be 2–80 characters each.";
      return { status: 400, view: { ...base, rowsError } };
    }
    try {
      return { status: 200, view: { ...base, assessment: await assessProfile(profile, rubric.data, fetcher) } };
    } catch (cause) {
      const problem = problemOf("The assessment could not be completed", cause, "Your criteria are still here; try again later.");
      return { status: statusOf(cause), view: { ...base, assessProblem: problem } };
    }
  }
  // Opened, or a criterion added or removed: nothing to run yet.
  return { status: 200, view: base };
}
