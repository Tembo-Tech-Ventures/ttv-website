import { describe, expect, it } from "vitest";
import {
  ANSWER_LIMITS,
  canEditAnswers,
  draftsFor,
  fieldName,
  formatAnswer,
  formatDraft,
  formQuestions,
  hasEditableAnswers,
  humanizeKey,
  labelSegments,
  parseApplicationAnswers,
  plainLabel,
  readAnswerSubmission,
  summaryQuestions,
  writeAnswers,
  type ApplicationQuestion,
} from "./application-answers";

/** An application imported from the old stack: version 1, questions carried with it. */
const LEGACY = {
  version: "1",
  name: "Njeri Wambui",
  partnerId: "",
  submission: [
    { type: "string", name: "name", label: "Name", value: "Njeri Wambui" },
    {
      type: "string",
      name: "partnerId",
      label: "Partner",
      value: null,
      options: [{ label: "Nairobi Makers", value: "partner-1" }],
    },
    {
      type: "requiredBoolean",
      name: "htmlCssDone",
      label: "Did you complete the free portion of the [HTML/CSS course](https://www.codecademy.com/learn/learn-html)?",
      value: true,
    },
    { type: "boolean", name: "gitDone", label: "Did you finish Git?", value: null },
    {
      type: "string",
      name: "track",
      label: "Which track?",
      value: "web",
      options: [{ label: "Web", value: "web" }, { label: "Data", value: "data" }],
    },
    { type: "textarea", name: "project", label: "Propose an idea for a project you would like to build.", value: "A chama ledger" },
    { type: "number", name: "hours", label: "Hours a week", value: 6 },
    { type: "date", name: "available", label: "Available from", value: "2027-01-15" },
  ],
};
const LEGACY_TEXT = JSON.stringify(LEGACY);

function questionsOf(text: string): readonly ApplicationQuestion[] {
  const answers = parseApplicationAnswers(text);
  if (answers.kind !== "questions") throw new Error(`expected questions, got ${answers.kind}`);
  return answers.questions;
}

function formOf(entries: Record<string, string>) {
  return (field: string) => entries[field] ?? null;
}

function validForm(overrides: Record<string, string> = {}) {
  return formOf({
    "answer.name": "Njeri Wambui",
    "answer.partnerId": "",
    "answer.htmlCssDone": "yes",
    "answer.gitDone": "",
    "answer.track": "web",
    "answer.project": "A chama ledger",
    "answer.hours": "6",
    "answer.available": "2027-01-15",
    ...overrides,
  });
}

describe("parseApplicationAnswers", () => {
  it("reads a self-application's {} as nothing asked", () => {
    expect(parseApplicationAnswers("{}")).toEqual({ kind: "empty" });
  });

  it("reads a staff enrolment as an enrolment, not as details", () => {
    expect(parseApplicationAnswers(JSON.stringify({ enrollment: { source: "ADMIN", schemaVersion: 1 } }))).toEqual({ kind: "enrollment" });
  });

  it("reads the legacy version 1 questions with their stored answers", () => {
    const questions = questionsOf(LEGACY_TEXT);
    expect(questions.map((question) => [question.name, question.type, question.value])).toEqual([
      ["name", "string", "Njeri Wambui"],
      ["partnerId", "string", null],
      ["htmlCssDone", "requiredBoolean", true],
      ["gitDone", "boolean", null],
      ["track", "string", "web"],
      ["project", "textarea", "A chama ledger"],
      ["hours", "number", 6],
      ["available", "date", "2027-01-15"],
    ]);
    expect(questions[1]?.options).toEqual([{ label: "Nairobi Makers", value: "partner-1" }]);
  });

  it("reads an untouched old required Yes/No (stored null) as No, as the old switch showed it", () => {
    const text = JSON.stringify({ version: "1", submission: [{ type: "requiredBoolean", name: "gitDone", label: "Git?", value: null }] });
    expect(questionsOf(text)[0]?.value).toBe(false);
    expect(formatAnswer(questionsOf(text)[0]!)).toBe("No");
  });

  it("accepts a numeric version and a missing value as unanswered", () => {
    const text = JSON.stringify({ version: 1, submission: [{ type: "textarea", name: "unique", label: "Why you?" }] });
    expect(questionsOf(text)[0]?.value).toBeNull();
  });

  it.each([
    ["an unknown question type", { type: "file", name: "cv", label: "CV" }],
    ["a missing label", { type: "string", name: "x", label: " " }],
    ["a name that is not an identifier", { type: "string", name: "a b", label: "A" }],
    ["an object answer", { type: "string", name: "x", label: "X", value: { nested: true } }],
    ["malformed options", { type: "string", name: "x", label: "X", options: [{ label: "A" }] }],
  ])("never offers fields for %s", (_, item) => {
    const answers = parseApplicationAnswers(JSON.stringify({ version: "1", submission: [item] }));
    expect(answers.kind).toBe("details");
    expect(canEditAnswers(answers, "PENDING")).toBe(false);
  });

  it("never offers fields for duplicate names, another version or an empty list", () => {
    const item = { type: "string", name: "x", label: "X" };
    for (const application of [
      { version: "1", submission: [item, item] },
      { version: "2", submission: [item] },
      { version: "1", submission: [] },
    ]) {
      expect(parseApplicationAnswers(JSON.stringify(application)).kind).not.toBe("questions");
    }
  });

  it("shows other recorded details in words, and says when some cannot be shown", () => {
    const answers = parseApplicationAnswers(
      JSON.stringify({ about: "I teach Python at a youth club", previousProjects: ["Shop POS", "Bus timetable"], ready: true, blank: "  ", gone: null, nested: { a: 1 } }),
    );
    expect(answers).toEqual({
      kind: "details",
      details: [
        { label: "About", value: "I teach Python at a youth club" },
        { label: "Previous projects", value: "Shop POS, Bus timetable" },
        { label: "Ready", value: "Yes" },
      ],
      hidden: true,
    });
  });

  it("treats only blank values as nothing recorded", () => {
    expect(parseApplicationAnswers(JSON.stringify({ about: "", note: null }))).toEqual({ kind: "empty" });
  });

  it("never shows text that is not a JSON object, but says something is recorded", () => {
    expect(parseApplicationAnswers("not json")).toEqual({ kind: "details", details: [], hidden: true });
    expect(parseApplicationAnswers("[1,2]")).toEqual({ kind: "details", details: [], hidden: true });
  });
});

describe("who can edit", () => {
  it("allows editing only questions on a pending application", () => {
    expect(hasEditableAnswers(LEGACY_TEXT, "PENDING")).toBe(true);
    for (const status of ["APPROVED", "AUDIT", "REJECTED", "COMPLETED"]) {
      expect(hasEditableAnswers(LEGACY_TEXT, status)).toBe(false);
    }
    expect(hasEditableAnswers("{}", "PENDING")).toBe(false);
    expect(hasEditableAnswers(JSON.stringify({ about: "x" }), "PENDING")).toBe(false);
  });
});

describe("drafts and read-only answers", () => {
  it("turns stored answers into field text", () => {
    expect(draftsFor(questionsOf(LEGACY_TEXT))).toEqual({
      name: "Njeri Wambui",
      partnerId: "",
      htmlCssDone: "yes",
      gitDone: "",
      track: "web",
      project: "A chama ledger",
      hours: "6",
      available: "2027-01-15",
    });
  });

  it("formats answers in words: Yes/No, option labels, and nothing for unanswered", () => {
    const [name, partner, html, git, track, , hours] = questionsOf(LEGACY_TEXT);
    expect(formatAnswer(name!)).toBe("Njeri Wambui");
    expect(formatAnswer(partner!)).toBeNull();
    expect(formatAnswer({ ...partner!, value: "partner-1" })).toBe("Nairobi Makers");
    expect(formatAnswer(html!)).toBe("Yes");
    expect(formatAnswer({ ...html!, value: false })).toBe("No");
    expect(formatAnswer(git!)).toBeNull();
    expect(formatAnswer(track!)).toBe("Web");
    expect(formatAnswer(hours!)).toBe("6");
  });

  it("never offers the partner link to members, and shows it only by name", () => {
    const questions = questionsOf(LEGACY_TEXT);
    expect(formQuestions(questions).map((question) => question.name)).not.toContain("partnerId");
    expect(summaryQuestions(questions).map((question) => question.name)).not.toContain("partnerId");
    const named = questions.map((question) => (question.name === "partnerId" ? { ...question, value: "partner-1" } : question));
    expect(summaryQuestions(named).map((question) => question.name)).toContain("partnerId");
    const bareId = questions.map((question) => (question.name === "partnerId" ? { ...question, options: [], value: "partner-1" } : question));
    expect(summaryQuestions(bareId).map((question) => question.name)).not.toContain("partnerId");
  });

  it("has nothing to edit when the partner link is the only question", () => {
    const text = JSON.stringify({ version: "1", submission: [{ type: "string", name: "partnerId", label: "Partner", value: "p" }] });
    expect(hasEditableAnswers(text, "PENDING")).toBe(false);
  });

  it("shows unsaved typed answers back in words", () => {
    const [, , html, , track, project] = questionsOf(LEGACY_TEXT);
    expect(formatDraft(html!, "no")).toBe("No");
    expect(formatDraft(track!, "data")).toBe("Data");
    expect(formatDraft(project!, "Line one\nLine two")).toBe("Line one\nLine two");
    expect(formatDraft(project!, "   ")).toBeNull();
  });

  it("names fields after their question", () => {
    expect(fieldName({ name: "project" })).toBe("answer.project");
  });
});

describe("readAnswerSubmission", () => {
  const questions = questionsOf(LEGACY_TEXT);

  it("accepts plain answers and converts them to stored values", () => {
    const result = readAnswerSubmission(
      questions,
      validForm({ "answer.gitDone": "no", "answer.project": "  A shared\r\nledger  ", "answer.partnerId": "partner-1", "answer.hours": "2.5", "answer.track": "data" }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The partner link is never read from the form.
    expect(Object.fromEntries(result.values)).toEqual({
      name: "Njeri Wambui",
      htmlCssDone: true,
      gitDone: false,
      track: "data",
      project: "A shared\nledger",
      hours: 2.5,
      available: "2027-01-15",
    });
  });

  it("stores blank optional answers as unanswered", () => {
    const result = readAnswerSubmission(questions, validForm({ "answer.project": "   ", "answer.hours": "", "answer.available": "" }));
    expect(result.ok && Object.fromEntries(result.values)).toMatchObject({ project: null, hours: null, available: null });
  });

  it("rejects bad answers with a message per field and keeps every field exactly as typed", () => {
    const typed = "I have built a market price SMS bot for my village.";
    const result = readAnswerSubmission(
      questions,
      validForm({
        "answer.htmlCssDone": "",
        "answer.project": typed,
        "answer.hours": "six",
        "answer.available": "2027-02-30",
        "answer.track": "track-unknown",
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toEqual({
      htmlCssDone: "Choose Yes or No.",
      hours: "Enter a number, like 3 or 2.5.",
      available: "Enter a real date, like 2027-01-15.",
      track: "Choose one of the listed options.",
    });
    expect(result.drafts).toMatchObject({ project: typed, hours: "six", available: "2027-02-30", track: "track-unknown" });
  });

  it("keeps a stored choice that is no longer among the options instead of wiping it", () => {
    const stale = questions.map((question) => (question.name === "track" ? { ...question, value: "mobile" } : question));
    const kept = readAnswerSubmission(stale, validForm({ "answer.track": "" }));
    expect(kept.ok && kept.values.get("track")).toBe("mobile");
    const changed = readAnswerSubmission(stale, validForm({ "answer.track": "data" }));
    expect(changed.ok && changed.values.get("track")).toBe("data");
    // A listed answer can still be cleared.
    const cleared = readAnswerSubmission(questions, validForm({ "answer.track": "" }));
    expect(cleared.ok && cleared.values.get("track")).toBeNull();
  });

  it("treats a missing field as blank, so an unanswered required choice is an error", () => {
    const result = readAnswerSubmission(questions, formOf({}));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(Object.keys(result.errors)).toEqual(["htmlCssDone"]);
    expect(result.drafts.project).toBe("");
  });

  it("accepts every number a number field can submit", () => {
    for (const [typed, value] of [["3", 3], ["-2.5", -2.5], [".5", 0.5], ["1e3", 1000], ["+4", 4]] as const) {
      const result = readAnswerSubmission(questions, validForm({ "answer.hours": typed }));
      expect({ typed, value: result.ok && result.values.get("hours") }).toEqual({ typed, value });
    }
  });

  it("limits answer length", () => {
    const long = "a".repeat(ANSWER_LIMITS.textarea + 1);
    const result = readAnswerSubmission(questions, validForm({ "answer.project": long, "answer.name": "b".repeat(ANSWER_LIMITS.string + 1) }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.project).toBe("Keep this answer to 5,000 characters or fewer.");
    expect(result.errors.name).toBe("Keep this answer to 500 characters or fewer.");
    expect(result.drafts.project).toBe(long);
  });

  it("ignores a raw JSON field: only named answers are read", () => {
    const result = readAnswerSubmission(questions, formOf({ application: '{"htmlCssDone":true}' }));
    expect(result.ok).toBe(false);
  });
});

describe("writeAnswers", () => {
  it("round-trips: written answers read back as the same questions and values", () => {
    const questions = questionsOf(LEGACY_TEXT);
    const result = readAnswerSubmission(questions, validForm({ "answer.project": "A matatu route finder", "answer.htmlCssDone": "no" }));
    if (!result.ok) throw new Error("expected valid answers");
    const written = writeAnswers(LEGACY_TEXT, result.values);
    const reread = questionsOf(written);
    expect(reread.map((question) => question.name)).toEqual(questions.map((question) => question.name));
    expect(draftsFor(reread)).toMatchObject({ project: "A matatu route finder", htmlCssDone: "no" });
  });

  it("keeps everything else stored, including options and unknown keys", () => {
    const text = JSON.stringify({ ...LEGACY, importedFrom: "prisma", submission: LEGACY.submission.map((item) => ({ ...item, extra: 1 })) });
    const values = new Map([["project", "New idea"]]);
    const written = JSON.parse(writeAnswers(text, values));
    expect(written.importedFrom).toBe("prisma");
    expect(written.version).toBe("1");
    expect(written.submission[1].options).toEqual([{ label: "Nairobi Makers", value: "partner-1" }]);
    expect(written.submission.every((item: { extra: number }) => item.extra === 1)).toBe(true);
    expect(written.submission[5].value).toBe("New idea");
    expect(written.submission[2].value).toBe(true);
  });

  it("updates the old stack's top-level copies of text answers", () => {
    const written = JSON.parse(writeAnswers(LEGACY_TEXT, new Map<string, string | null>([["name", "Njeri W."]])));
    expect(written.name).toBe("Njeri W.");
    expect(written.partnerId).toBe("");
    expect(written.submission[0].value).toBe("Njeri W.");
    expect(written.submission[1].value).toBeNull();
  });

  it("never lets an answer overwrite the schema's own keys", () => {
    const text = JSON.stringify({ version: "1", submission: [{ type: "string", name: "version", label: "Which version?", value: "1" }] });
    const written = JSON.parse(writeAnswers(text, new Map([["version", "2"]])));
    expect(written.version).toBe("1");
    expect(written.submission[0].value).toBe("2");
    expect(parseApplicationAnswers(JSON.stringify(written)).kind).toBe("questions");
  });

  it("refuses to write into an application with no questions", () => {
    expect(() => writeAnswers("{}", new Map([["about", "x"]]))).toThrow("no questions");
  });
});

describe("labels", () => {
  it("splits markdown links into words and https links", () => {
    expect(labelSegments("Did you complete the [HTML/CSS course](https://www.codecademy.com/learn/learn-html)?")).toEqual([
      { text: "Did you complete the " },
      { text: "HTML/CSS course", href: "https://www.codecademy.com/learn/learn-html" },
      { text: "?" },
    ]);
  });

  it("leaves anything that is not an http(s) link as text", () => {
    expect(labelSegments("Click [here](javascript:alert(1)) now")).toEqual([{ text: "Click [here](javascript:alert(1)) now" }]);
    expect(labelSegments("Plain question")).toEqual([{ text: "Plain question" }]);
  });

  it("reads as plain words for summaries", () => {
    expect(plainLabel("Did you complete the [Git course](https://www.codecademy.com/learn/learn-git-introduction)?")).toBe("Did you complete the Git course?");
  });

  it("humanizes stored keys", () => {
    expect(humanizeKey("previousProjects")).toBe("Previous projects");
    expect(humanizeKey("open_to_roles")).toBe("Open to roles");
    expect(humanizeKey("___")).toBe("___");
  });
});
