import { isSameOriginRequest } from "@/lib/agent-auth";
import { boundedForm } from "@/components/platform/onboarding/welcome-flow";
import { SPACE_PATHS } from "@/lib/platform/server/space-routes";
import type { JourneyClaim } from "@/components/discovery/types";

/**
 * Community's own forms, posted to the page without JavaScript: a new
 * contribution, a contribution's next revision, and the community profile.
 * Each is read here, explained field by field before the API would have to
 * refuse it, and sent as the JSON body `/api/community/*` takes, through the
 * API's own handler (`send`), so its sign-in, origin, scope and validation
 * checks stay the API's. The limits mirror lib/community/model.ts.
 */
export const COMMUNITY_HOME_PATH = SPACE_PATHS.community;

/** Which editor is open: from the address on a GET, from the posted form after a refusal. */
export type HomeEditor =
  | { kind: "add" }
  | { kind: "edit"; claim: JourneyClaim }
  | { kind: "profile" };

const ADD_PARAM = "add";
const EDIT_PARAM = "edit";
const PROFILE_PARAM = "profile";
export const CONTRIBUTION_EDITOR_ID = "contribution-editor";
export const PROFILE_EDITOR_ID = "profile-editor";

/** The links that open an editor: plain GETs, so they work without a script. */
export const addHref = () => `${COMMUNITY_HOME_PATH}?${ADD_PARAM}=1#${CONTRIBUTION_EDITOR_ID}`;
export const editHref = (claim: Pick<JourneyClaim, "id">) =>
  `${COMMUNITY_HOME_PATH}?${EDIT_PARAM}=${encodeURIComponent(claim.id)}#${CONTRIBUTION_EDITOR_ID}`;
export const profileHref = () => `${COMMUNITY_HOME_PATH}?${PROFILE_PARAM}=edit#${PROFILE_EDITOR_ID}`;

/** The editor the address asks for. An edit of a contribution that isn't the caller's opens nothing. */
export function editorFromUrl(url: URL, claims: readonly JourneyClaim[]): HomeEditor | null {
  const edit = url.searchParams.get(EDIT_PARAM);
  if (edit !== null) {
    const claim = claims.find((item) => item.id === edit);
    return claim && claim.kind !== "repo" ? { kind: "edit", claim } : null;
  }
  if (url.searchParams.get(PROFILE_PARAM) === "edit") return { kind: "profile" };
  if (url.searchParams.has(ADD_PARAM)) return { kind: "add" };
  return null;
}

// ---- Contributions ----------------------------------------------------------

export const TITLE_MAX = 160;
export const DESCRIPTION_MAX = 6000;
export const SOURCE_MAX = 2000;

export interface ContributionValues {
  title: string;
  description: string;
  date: string;
  sourceUrl: string;
}
export type ContributionField = keyof ContributionValues;
export type ContributionErrors = Partial<Record<ContributionField, string>>;

export const EMPTY_CONTRIBUTION: ContributionValues = { title: "", description: "", date: "", sourceUrl: "" };

export function contributionValuesOf(claim: JourneyClaim): ContributionValues {
  return { title: claim.title, description: claim.description, date: claim.date, sourceUrl: claim.evidence[0]?.url ?? "" };
}

const isCalendarDate = (value: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;

/** A source must be a public HTTPS page: no credentials, nothing inside this app. */
function sourceProblem(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || /^\/(admin|api|dashboard)(?:\/|$)/i.test(url.pathname)) {
      return "Use a public HTTPS link without credentials or private application paths.";
    }
    return null;
  } catch {
    return "Use a complete public HTTPS link for your source.";
  }
}

export function validateContribution(values: ContributionValues): ContributionErrors {
  const errors: ContributionErrors = {};
  const title = values.title.trim();
  const description = values.description.trim();
  const source = values.sourceUrl.trim();
  if (title.length > TITLE_MAX) errors.title = `Keep the title within ${TITLE_MAX} characters.`;
  else if (title.length < 3) errors.title = "Give this entry a title of at least 3 characters.";
  if (description.length > DESCRIPTION_MAX) errors.description = "Keep the contribution within 6,000 characters.";
  else if (description.length < 20) errors.description = "Describe your contribution in at least 20 characters.";
  if (!isCalendarDate(values.date)) errors.date = "Choose a date for this contribution.";
  if (source.length > SOURCE_MAX) errors.sourceUrl = `Keep the link within ${SOURCE_MAX.toLocaleString("en-GB")} characters.`;
  else if (source) {
    const problem = sourceProblem(source);
    if (problem) errors.sourceUrl = problem;
  }
  return errors;
}

// ---- The community profile --------------------------------------------------

export const HEADLINE_MAX = 160;
export const BIO_MAX = 4000;
export const SKILLS_MAX = 30;
export const SKILL_MAX = 60;
export const GOALS_MAX = 2000;

export interface ProfileValues {
  headline: string;
  bio: string;
  /** As typed: comma-separated. */
  skills: string;
  opportunityGoals: string;
}
export type ProfileField = keyof ProfileValues;
export type ProfileErrors = Partial<Record<ProfileField, string>>;

export function profileValuesOf(profile: { headline: string; about: string; skills: readonly string[]; goal: string }): ProfileValues {
  return { headline: profile.headline, bio: profile.about, skills: profile.skills.join(", "), opportunityGoals: profile.goal };
}

export const parseSkills = (value: string) => value.split(",").map((skill) => skill.trim()).filter(Boolean);

export function validateProfile(values: ProfileValues): ProfileErrors {
  const errors: ProfileErrors = {};
  const skills = parseSkills(values.skills);
  if (values.headline.trim().length > HEADLINE_MAX) errors.headline = `Keep your headline within ${HEADLINE_MAX} characters.`;
  if (values.bio.trim().length > BIO_MAX) errors.bio = "Keep the description of your work within 4,000 characters.";
  if (skills.length > SKILLS_MAX) errors.skills = `Add no more than ${SKILLS_MAX} skills.`;
  else if (skills.some((skill) => skill.length > SKILL_MAX)) errors.skills = `Keep each skill within ${SKILL_MAX} characters.`;
  if (values.opportunityGoals.trim().length > GOALS_MAX) errors.opportunityGoals = "Keep your opportunity goals within 2,000 characters.";
  return errors;
}

// ---- The post ---------------------------------------------------------------

/** What the API would be sent: its path under /api/community/, method and JSON body. */
export interface CommunityWrite {
  path: string;
  method: "POST" | "PUT";
  body: unknown;
}

/** Why a save failed after the form passed its own checks, as the danger notice says it. */
export interface HomeFailure {
  title: string;
  detail: string;
}

export type HomeRender =
  | { form: "contribution"; claimId: string | null; values: ContributionValues; errors: ContributionErrors }
  | { form: "profile"; values: ProfileValues; errors: ProfileErrors };

export type SavedForm = "added" | "updated" | "profile";

export type HomePostResult =
  | { kind: "saved"; saved: SavedForm }
  | { kind: "render"; status: number; render: HomeRender; failure: HomeFailure | null }
  | { kind: "refuse"; status: 400 | 403 | 413 };

const KEPT = "Everything you wrote is still here.";
const CHANGED: HomeFailure = { title: "This contribution changed since you opened it", detail: `Reload before editing. ${KEPT}` };
const text = (form: FormData, name: string, max: number) => {
  const value = form.get(name);
  // Generous bounds: a refusal shows what was typed, and nothing unbounded is held.
  return typeof value === "string" ? value.slice(0, max * 4) : "";
};

/** What each successful save says once, after its 303. */
export const SAVED_FLASH: Record<SavedForm, { title: string; message?: string }> = {
  added: { title: "Your contribution has been saved." },
  updated: {
    title: "Your contribution has been updated.",
    message: "Earlier mentor statements remain attached to their reviewed revision.",
  },
  profile: { title: "Profile saved." },
};

/** A form that passed its own checks, and the call that saves it; or the refusal to render. */
type Prepared = { render: HomeRender; write: CommunityWrite; saved: SavedForm } | Extract<HomePostResult, { kind: "render" }>;

function prepareContribution(form: FormData, claims: readonly JourneyClaim[]): Prepared {
  const values: ContributionValues = {
    title: text(form, "title", TITLE_MAX),
    description: text(form, "description", DESCRIPTION_MAX),
    date: text(form, "date", 10),
    sourceUrl: text(form, "sourceUrl", SOURCE_MAX),
  };
  const id = form.get("id");
  const claimId = typeof id === "string" && id ? id : null;
  const render: HomeRender = { form: "contribution", claimId, values, errors: validateContribution(values) };
  if (Object.keys(render.errors).length > 0) return { kind: "render", status: 400, render, failure: null };
  const body = {
    title: values.title.trim(),
    description: values.description.trim(),
    evidenceUrl: values.sourceUrl.trim() || null,
    occurredAt: values.date,
  };
  if (!claimId) return { render, saved: "added", write: { path: "journey", method: "POST", body: { ...body, status: "posted" } } };
  const revision = Number(form.get("revision"));
  const claim = claims.find((item) => item.id === claimId);
  if (!claim || !Number.isSafeInteger(revision) || revision < 1) return { kind: "render", status: 409, render, failure: CHANGED };
  return {
    render,
    saved: "updated",
    write: { path: `journey/${encodeURIComponent(claimId)}`, method: "PUT", body: { ...body, status: claim.status, expectedRevision: revision } },
  };
}

function prepareProfile(form: FormData): Prepared {
  const values: ProfileValues = {
    headline: text(form, "headline", HEADLINE_MAX),
    bio: text(form, "bio", BIO_MAX),
    skills: text(form, "skills", (SKILL_MAX + 2) * SKILLS_MAX),
    opportunityGoals: text(form, "opportunityGoals", GOALS_MAX),
  };
  const render: HomeRender = { form: "profile", values, errors: validateProfile(values) };
  if (Object.keys(render.errors).length > 0) return { kind: "render", status: 400, render, failure: null };
  const body = {
    headline: values.headline.trim(),
    bio: values.bio.trim(),
    skills: parseSkills(values.skills),
    opportunityGoals: values.opportunityGoals.trim(),
  };
  return { render, saved: "profile", write: { path: "profile", method: "PUT", body } };
}

/**
 * Handles a post to Community. `claims` are the caller's own, as the page read them, so an edit
 * keeps its contribution's visibility; `send` answers as `/api/community/<path>` would.
 */
export async function handleCommunityHomePost(
  request: Request,
  claims: readonly JourneyClaim[],
  send: (write: CommunityWrite) => Promise<Response>,
): Promise<HomePostResult> {
  if (!isSameOriginRequest(request)) return { kind: "refuse", status: 403 };
  const form = await boundedForm(request);
  if (!form) return { kind: "refuse", status: 413 };
  const kind = form.get("form");
  if (kind !== "contribution" && kind !== "profile") return { kind: "refuse", status: 400 };
  const prepared = kind === "contribution" ? prepareContribution(form, claims) : prepareProfile(form);
  if ("kind" in prepared) return prepared;

  const { render, write, saved } = prepared;
  const unavailable: HomeFailure = {
    title: `Couldn't save ${render.form === "profile" ? "your profile" : "your contribution"}`,
    detail: `${KEPT} Try saving again in a moment.`,
  };
  const failed = (status: number, failure: HomeFailure): HomePostResult => ({ kind: "render", status, render, failure });
  let response: Response;
  try {
    response = await send(write);
  } catch {
    return failed(503, unavailable);
  }
  if (response.ok) return { kind: "saved", saved };
  if (response.status >= 500) return failed(503, unavailable);
  if (response.status === 409) return failed(409, CHANGED);
  // A refusal the form could not foresee: the API's own sentence.
  const reply = (await response.json().catch(() => null)) as { error?: unknown } | null;
  const reason = typeof reply?.error === "string" ? `${reply.error} ` : "";
  return failed(response.status, { title: unavailable.title, detail: `${reason}${KEPT}` });
}
