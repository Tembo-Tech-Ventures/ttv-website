import { ChoiceGroup, DescriptionItem, DescriptionList, SelectField, TextAreaField, TextField, linkClass } from "@/components/platform/ui";
import {
  ANSWER_LIMITS,
  fieldName,
  labelSegments,
  type ApplicationAnswerDrafts,
  type ApplicationQuestion,
} from "@/lib/student/application-answers";

/**
 * An application question's wording. Questions imported from the old stack
 * hold markdown links ("the free portion of the [HTML/CSS course](https://…)"),
 * which read as words with links, in the ink of the words around them.
 */
export function QuestionText({ label }: { label: string }) {
  return (
    <>
      {labelSegments(label).map((segment, index) =>
        segment.href ? (
          <a key={index} href={segment.href} target="_blank" rel="noopener noreferrer" className={linkClass()}>
            {segment.text}
            <span className="sr-only"> (opens in a new tab)</span>
          </a>
        ) : (
          segment.text
        ),
      )}
    </>
  );
}

/** The id a question's control carries, which the error summary links to. */
export function answerId(question: Pick<ApplicationQuestion, "name">, type?: ApplicationQuestion["type"]): string {
  // A yes/no question is a group of radios: the link lands on its first, "yes".
  return type === "boolean" || type === "requiredBoolean" ? `${fieldName(question)}-yes` : `answer-${question.name}`;
}

const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
] as const;

/**
 * A pending application's questions as the kit's fields, each keeping what was
 * typed and saying under itself what is wrong. Rendered on the server from
 * ApplicationAnswers.astro, with no script: the form posts to its page.
 */
export default function AnswerFields({
  questions,
  drafts,
  errors,
}: {
  questions: readonly ApplicationQuestion[];
  drafts: ApplicationAnswerDrafts;
  errors: Readonly<Record<string, string>>;
}) {
  return (
    <>
      {questions.map((question) => {
        const label = <QuestionText label={question.label} />;
        const draft = drafts[question.name] ?? "";
        const error = errors[question.name];
        const name = fieldName(question);
        if (question.type === "boolean" || question.type === "requiredBoolean") {
          return (
            <ChoiceGroup
              key={question.name}
              name={name}
              label={label}
              options={YES_NO}
              defaultValue={draft}
              error={error}
              required={question.type === "requiredBoolean"}
            />
          );
        }
        const id = answerId(question);
        if (question.type === "textarea") {
          return <TextAreaField key={question.name} id={id} name={name} label={label} rows={5} maxLength={ANSWER_LIMITS.textarea} defaultValue={draft} error={error} />;
        }
        if (question.type === "string" && question.options.length > 0) {
          return (
            <SelectField
              key={question.name}
              id={id}
              name={name}
              label={label}
              placeholder="Choose one"
              options={question.options.map((option) => ({ value: option.value, label: option.label }))}
              defaultValue={draft}
              error={error}
            />
          );
        }
        return (
          <TextField
            key={question.name}
            id={id}
            name={name}
            label={label}
            type={question.type === "date" ? "date" : question.type === "number" ? "number" : "text"}
            step={question.type === "number" ? "any" : undefined}
            inputMode={question.type === "number" ? "decimal" : undefined}
            maxLength={question.type === "string" ? ANSWER_LIMITS.string : undefined}
            defaultValue={draft}
            error={error}
          />
        );
      })}
    </>
  );
}

/**
 * Recorded answers, or answers that weren't saved, as name and value: each question's wording (links
 * and all) beside what was answered. `label` is a question as written; `plain` labels are shown as is.
 */
export function AnswerList({ items }: { items: readonly { label: string; plain?: boolean; value: string | null }[] }) {
  return (
    <DescriptionList>
      {items.map((item, index) => (
        <DescriptionItem key={index} term={item.plain ? item.label : <QuestionText label={item.label} />}>
          <span className={item.value === null ? "text-ink-muted" : "whitespace-pre-line"}>{item.value ?? "Not answered"}</span>
        </DescriptionItem>
      ))}
    </DescriptionList>
  );
}
