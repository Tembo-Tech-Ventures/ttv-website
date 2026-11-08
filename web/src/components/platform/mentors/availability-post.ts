import {
  ErrorEnvelope, MAX_MONTHLY_CAPACITY, MentorRequestFormat, UpdateMentorAvailability, type MentorAvailability,
} from "@/lib/platform/contracts";
import { isSameOriginRequest } from "@/lib/agent-auth";
import { boundedForm } from "@/components/platform/onboarding/welcome-flow";

/**
 * Saving a mentor's availability without JavaScript (U-4.1). The page is a
 * plain form that posts to itself; this reads it, explains a problem before
 * the server has to refuse it, and hands the body to the API's own handler
 * (`mentorsServer(...).saveAvailability`), so every gate and the contract stay
 * the API's.
 *
 * Rules mirror UpdateMentorAvailability: a headline of up to 120 characters,
 * up to 20 areas of up to 40 characters each (each once, ignoring case), at
 * least one format, 0 to 20 requests a month and a bio of up to 2,000.
 */
const MAX_HEADLINE = 120;
export const MAX_AREA = 40;
export const MAX_AREAS = 20;
export const MAX_BIO = 2000;

type AvailabilityField = "headline" | "areas" | "formats" | "monthlyCapacity" | "bio";
export type AvailabilityErrors = Partial<Record<AvailabilityField, string>>;

/** What the form shows: the saved availability, or what was posted, as typed. Areas are one a line. */
export interface AvailabilityValues {
  headline: string;
  areas: string;
  formats: MentorRequestFormat[];
  monthlyCapacity: string;
  bio: string;
  paused: boolean;
}

const FIELD_MESSAGES: Record<AvailabilityField, string> = {
  headline: `Write a headline of up to ${MAX_HEADLINE} characters.`,
  areas: `List up to ${MAX_AREAS} areas, each once and up to ${MAX_AREA} characters.`,
  formats: "Offer at least one way to help.",
  monthlyCapacity: `Choose a number from 0 to ${MAX_MONTHLY_CAPACITY}.`,
  bio: `Keep the bio to ${MAX_BIO} characters.`,
};

export function valuesOf(saved: MentorAvailability): AvailabilityValues {
  return {
    headline: saved.headline, areas: saved.areas.join("\n"), formats: [...saved.formats],
    monthlyCapacity: String(saved.monthlyCapacity), bio: saved.bio, paused: saved.paused,
  };
}

const text = (value: FormDataEntryValue | null, max: number) => typeof value === "string" ? value.slice(0, max) : "";

/** The posted values, kept as typed (within generous bounds) so a refusal shows them again. */
export function readAvailabilityForm(form: FormData): AvailabilityValues {
  const posted = new Set(form.getAll("formats"));
  return {
    headline: text(form.get("headline"), MAX_HEADLINE * 4),
    areas: text(form.get("areas"), (MAX_AREA + 1) * MAX_AREAS * 4),
    // In the contract's order, whatever order the browser sent them in.
    formats: MentorRequestFormat.options.filter((format) => posted.has(format)),
    monthlyCapacity: text(form.get("monthlyCapacity"), 10),
    bio: text(form.get("bio"), MAX_BIO * 4),
    paused: form.get("paused") !== null,
  };
}

/** One area a line: each trimmed, blank lines dropped. */
const areaLines = (areas: string) => areas.split(/\r?\n/).map((area) => area.trim()).filter(Boolean);

/** The body to save, or a message per field to fix. */
export function validateAvailability(values: AvailabilityValues):
  { ok: true; body: UpdateMentorAvailability } | { ok: false; errors: AvailabilityErrors } {
  const capacity = values.monthlyCapacity.trim();
  const result = UpdateMentorAvailability.safeParse({
    headline: values.headline.trim(), areas: areaLines(values.areas), formats: values.formats,
    monthlyCapacity: /^\d{1,3}$/.test(capacity) ? Number(capacity) : Number.NaN, bio: values.bio.trim(), paused: values.paused,
  });
  if (result.success) return { ok: true, body: result.data };
  const errors: AvailabilityErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && field in FIELD_MESSAGES) errors[field as AvailabilityField] ??= FIELD_MESSAGES[field as AvailabilityField];
  }
  return { ok: false, errors };
}

/** Why a save failed, as the page's danger notice says it. */
export interface AvailabilityFailure {
  title: string;
  detail: string;
}

export type AvailabilityPostResult =
  | { kind: "saved" }
  | { kind: "render"; status: number; values: AvailabilityValues; errors: AvailabilityErrors; failure: AvailabilityFailure | null }
  | { kind: "refuse"; status: 403 | 413 };

const KEPT = "Everything you wrote is still here.";

/**
 * Handles the availability form's post. The caller has already checked that `mentor_requests` is on
 * and the page is this person's; `save` sends the body as `PUT /api/mentoring/availability` would.
 */
export async function handleAvailabilityPost(
  request: Request, save: (body: UpdateMentorAvailability) => Promise<Response>,
): Promise<AvailabilityPostResult> {
  if (!isSameOriginRequest(request)) return { kind: "refuse", status: 403 };
  const form = await boundedForm(request);
  if (!form) return { kind: "refuse", status: 413 };
  const values = readAvailabilityForm(form);
  const checked = validateAvailability(values);
  if (!checked.ok) return { kind: "render", status: 400, values, errors: checked.errors, failure: null };

  const failed = (status: number, detail: string): AvailabilityPostResult =>
    ({ kind: "render", status, values, errors: {}, failure: { title: "Couldn't save your availability", detail } });
  let response: Response;
  try {
    response = await save(checked.body);
  } catch {
    return failed(500, `${KEPT} Try saving again in a moment.`);
  }
  if (response.ok) return { kind: "saved" };
  if (response.status >= 500) return failed(response.status, `${KEPT} Try saving again in a moment.`);
  // A refusal the form could not foresee (the mentor role taken away, say): the API's own sentence.
  const envelope = ErrorEnvelope.safeParse(await response.json().catch(() => null));
  return failed(response.status, envelope.success ? `${envelope.data.error.message} ${KEPT}` : KEPT);
}
