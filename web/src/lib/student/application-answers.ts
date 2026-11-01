import { getEnrollmentSource } from "@/lib/admin/program-application";

/**
 * A member's cohort application answers, read from the JSON text stored in
 * `programApplication.application`, and written back to it.
 *
 * Programs do not define application questions. Self-applications store `{}`,
 * staff enrolments store an `enrollment` marker, and applications imported from
 * the old stack carry their own questions in a versioned `submission` list
 * (the stack's "application schema" version 1):
 *
 *   { "version": "1", "submission": [{ "type", "name", "label", "value", "options"? }], ... }
 *
 * Those are the only questions a member can answer, so they are the only ones
 * rendered as fields. Members never see or type JSON: anything else stored is
 * shown read-only, in words.
 */

export const APPLICATION_QUESTION_TYPES = [
  "boolean",
  "requiredBoolean",
  "string",
  "textarea",
  "number",
  "date",
] as const;

export type ApplicationQuestionType = (typeof APPLICATION_QUESTION_TYPES)[number];

export type ApplicationAnswerValue = string | number | boolean | null;

export interface ApplicationQuestionOption {
  label: string;
  value: string;
}

export interface ApplicationQuestion {
  name: string;
  type: ApplicationQuestionType;
  /** The question as written, which may hold markdown links. */
  label: string;
  options: readonly ApplicationQuestionOption[];
  value: ApplicationAnswerValue;
}

export interface ApplicationDetail {
  label: string;
  value: string;
}

export type ApplicationAnswers =
  /** Questions the member answered, or can answer while the application is pending. */
  | { kind: "questions"; questions: readonly ApplicationQuestion[] }
  /** Staff added the member to the cohort, so nothing was asked. */
  | { kind: "enrollment" }
  /** Nothing was asked and nothing recorded. */
  | { kind: "empty" }
  /** Other recorded details, in words. `hidden` when some could not be shown that way. */
  | { kind: "details"; details: readonly ApplicationDetail[]; hidden: boolean };

/** The raw text of each field as submitted, so a rejected form comes back exactly as typed. */
export type ApplicationAnswerDrafts = Readonly<Record<string, string>>;

export type ApplicationAnswerSubmission =
  | { ok: true; drafts: ApplicationAnswerDrafts; values: ReadonlyMap<string, ApplicationAnswerValue> }
  | { ok: false; drafts: ApplicationAnswerDrafts; errors: Readonly<Record<string, string>> };

export const ANSWER_LIMITS = { string: 500, textarea: 5_000 } as const;

const QUESTION_NAME = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
/** Top-level keys that hold the schema itself, never a copy of an answer. */
const STRUCTURAL_KEYS = new Set(["version", "submission"]);
const DATE_VALUE = /^\d{4}-\d{2}-\d{2}$/;
/** What a number field can submit: "3", "-2.5", ".5", "1e3". */
const NUMBER_VALUE = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isQuestionType = (value: unknown): value is ApplicationQuestionType =>
  APPLICATION_QUESTION_TYPES.some((type) => type === value);

const isAnswerValue = (value: unknown): value is ApplicationAnswerValue =>
  value === null || ["string", "number", "boolean"].includes(typeof value);

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function parseOptions(value: unknown): ApplicationQuestionOption[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const options: ApplicationQuestionOption[] = [];
  for (const option of value) {
    if (!isRecord(option) || typeof option.label !== "string" || typeof option.value !== "string") return null;
    options.push({ label: option.label, value: option.value });
  }
  return options;
}

function parseQuestion(item: unknown): ApplicationQuestion | null {
  if (!isRecord(item)) return null;
  const { type, name, label } = item;
  const value = item.value ?? null;
  if (!isQuestionType(type) || typeof name !== "string" || !QUESTION_NAME.test(name)) return null;
  if (typeof label !== "string" || label.trim() === "" || !isAnswerValue(value)) return null;
  const options = parseOptions(item.options);
  if (!options) return null;
  // The old form showed a required Yes/No as a switch that starts off: an
  // untouched one was stored as null and read "No" to the applicant.
  return { name, type, label, options, value: type === "requiredBoolean" && value === null ? false : value };
}

/** The legacy version 1 questions, or null when the stored shape is anything else. */
function parseQuestions(application: JsonRecord): ApplicationQuestion[] | null {
  if (String(application.version) !== "1" || !Array.isArray(application.submission)) return null;
  if (application.submission.length === 0) return null;
  const questions = application.submission.map(parseQuestion);
  if (questions.some((question) => question === null)) return null;
  const valid = questions as ApplicationQuestion[];
  return new Set(valid.map((question) => question.name)).size === valid.length ? valid : null;
}

/** "previousProjects" or "previous_projects" → "Previous projects". */
export function humanizeKey(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .toLowerCase();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : key;
}

function detailValue(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return formatScalar(value);
  if (Array.isArray(value) && value.length > 0 && value.every((entry) => ["string", "number", "boolean"].includes(typeof entry))) {
    return value.map((entry) => formatScalar(entry as string | number | boolean)).join(", ");
  }
  return null;
}

function formatScalar(value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

export function parseApplicationAnswers(text: string): ApplicationAnswers {
  const application = parseJson(text);
  if (!isRecord(application)) return { kind: "details", details: [], hidden: text.trim() !== "" };
  if (Object.keys(application).length === 0) return { kind: "empty" };
  if (getEnrollmentSource(text) === "ADMIN") return { kind: "enrollment" };

  const questions = parseQuestions(application);
  if (questions) return { kind: "questions", questions };

  const details: ApplicationDetail[] = [];
  let hidden = false;
  for (const [key, value] of Object.entries(application)) {
    if (value === null || (typeof value === "string" && value.trim() === "")) continue;
    const shown = detailValue(value);
    if (shown === null) hidden = true;
    else details.push({ label: humanizeKey(key), value: shown });
  }
  return details.length === 0 && !hidden ? { kind: "empty" } : { kind: "details", details, hidden };
}

/**
 * Whether a member answers this question. The old stack's "partnerId" records
 * which partner organisation an applicant came through; staff own that link,
 * so members never edit it.
 */
export function isMemberAnswerable(question: Pick<ApplicationQuestion, "name">): boolean {
  return question.name !== "partnerId";
}

/** The questions the answers form offers. */
export function formQuestions(questions: readonly ApplicationQuestion[]): ApplicationQuestion[] {
  return questions.filter(isMemberAnswerable);
}

/** The questions the read-only view shows: a partner only by name, never as a bare id. */
export function summaryQuestions(questions: readonly ApplicationQuestion[]): ApplicationQuestion[] {
  return questions.filter(
    (question) => isMemberAnswerable(question) || question.options.some((option) => option.value === question.value),
  );
}

/** Whether a member can change these answers: questions to answer, on a pending application. */
export function canEditAnswers(answers: ApplicationAnswers, status: string): boolean {
  return status === "PENDING" && answers.kind === "questions" && formQuestions(answers.questions).length > 0;
}

export function hasEditableAnswers(text: string, status: string): boolean {
  return canEditAnswers(parseApplicationAnswers(text), status);
}

/** A question's stored answer as a form field's text. */
export function toDraft(question: ApplicationQuestion): string {
  const { value, type } = question;
  if (value === null) return "";
  if (type === "boolean" || type === "requiredBoolean") return value === true ? "yes" : value === false ? "no" : "";
  return String(value);
}

export function draftsFor(questions: readonly ApplicationQuestion[]): ApplicationAnswerDrafts {
  return Object.fromEntries(questions.map((question) => [question.name, toDraft(question)]));
}

/** A stored answer in words, for the read-only view. */
export function formatAnswer(question: ApplicationQuestion): string | null {
  const { value } = question;
  if (value === null || value === "") return null;
  const option = question.options.find((candidate) => candidate.value === value);
  if (option) return option.label;
  return formatScalar(value);
}

export function fieldName(question: Pick<ApplicationQuestion, "name">): string {
  return `answer.${question.name}`;
}

function isRealDate(text: string): boolean {
  if (!DATE_VALUE.test(text)) return false;
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text;
}

type AnswerResult = { value: ApplicationAnswerValue } | { error: string };

function readChoice(text: string, required: boolean): AnswerResult {
  if (text === "yes" || text === "no") return { value: text === "yes" };
  return !required && text === "" ? { value: null } : { error: "Choose Yes or No." };
}

function readText(question: ApplicationQuestion & { type: "string" | "textarea" }, draft: string): AnswerResult {
  const limit = ANSWER_LIMITS[question.type];
  if (draft.length > limit) return { error: `Keep this answer to ${limit.toLocaleString("en-US")} characters or fewer.` };
  const text = draft.trim();
  const isOption = (value: unknown) => question.options.some((option) => option.value === value);
  if (question.options.length > 0 && text !== "" && !isOption(text)) {
    return { error: "Choose one of the listed options." };
  }
  // A stored answer that is no longer among the options cannot be shown as
  // selected, so the list posts "Choose one": keep the answer rather than wipe it.
  if (question.options.length > 0 && text === "" && question.value !== null && !isOption(question.value)) {
    return { value: question.value };
  }
  return { value: text === "" ? null : text };
}

function readAnswer(question: ApplicationQuestion, draft: string): AnswerResult {
  const text = draft.trim();
  switch (question.type) {
    case "requiredBoolean":
    case "boolean":
      return readChoice(text, question.type === "requiredBoolean");
    case "number":
      if (text === "") return { value: null };
      return NUMBER_VALUE.test(text) && Number.isFinite(Number(text))
        ? { value: Number(text) }
        : { error: "Enter a number, like 3 or 2.5." };
    case "date":
      if (text === "") return { value: null };
      return isRealDate(text) ? { value: text } : { error: "Enter a real date, like 2027-01-15." };
    case "string":
    case "textarea":
      return readText({ ...question, type: question.type }, draft);
  }
}

/**
 * Reads and checks a submitted answers form. Every field is read as text, so
 * on any error the member gets back exactly what they typed.
 */
export function readAnswerSubmission(
  questions: readonly ApplicationQuestion[],
  read: (field: string) => FormDataEntryValue | null,
): ApplicationAnswerSubmission {
  const drafts: Record<string, string> = {};
  const errors: Record<string, string> = {};
  const values = new Map<string, ApplicationAnswerValue>();

  for (const question of formQuestions(questions)) {
    const entry = read(fieldName(question));
    // Browsers send textarea line breaks as CRLF.
    const draft = typeof entry === "string" ? entry.replace(/\r\n?/g, "\n") : "";
    drafts[question.name] = draft;
    const result = readAnswer(question, draft);
    if ("error" in result) errors[question.name] = result.error;
    else values.set(question.name, result.value);
  }

  return Object.keys(errors).length > 0 ? { ok: false, drafts, errors } : { ok: true, drafts, values };
}

/**
 * The stored JSON with new answers written into its questions. Everything else
 * is kept as it was. Top-level copies of a text answer, which the old stack
 * kept beside the list (`name`, `partnerId`), are updated with it.
 */
export function writeAnswers(text: string, values: ReadonlyMap<string, ApplicationAnswerValue>): string {
  const application = parseJson(text);
  if (!isRecord(application) || !parseQuestions(application)) {
    throw new Error("This application has no questions to answer.");
  }
  const submission = (application.submission as JsonRecord[]).map((item) => {
    const name = item.name as string;
    return values.has(name) ? { ...item, value: values.get(name) ?? null } : item;
  });
  const mirrored = Object.fromEntries(
    Object.entries(application)
      .filter(([key, current]) => !STRUCTURAL_KEYS.has(key) && values.has(key) && (typeof current === "string" || current === null))
      .map(([key]) => {
        const value = values.get(key);
        return [key, typeof value === "string" ? value : ""];
      }),
  );
  return JSON.stringify({ ...application, ...mirrored, submission });
}

export type LabelSegment = { text: string; href?: string };

/** A question label as text and links. Only `[text](https://…)` links become links. */
export function labelSegments(label: string): LabelSegment[] {
  const segments: LabelSegment[] = [];
  const link = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let last = 0;
  for (const match of label.matchAll(link)) {
    const index = match.index ?? 0;
    if (index > last) segments.push({ text: label.slice(last, index) });
    segments.push({ text: match[1] ?? "", href: match[2] });
    last = index + match[0].length;
  }
  if (last < label.length) segments.push({ text: label.slice(last) });
  return segments;
}

/** A question label as plain words, links reduced to their text. */
export function plainLabel(label: string): string {
  return labelSegments(label).map((segment) => segment.text).join("");
}
