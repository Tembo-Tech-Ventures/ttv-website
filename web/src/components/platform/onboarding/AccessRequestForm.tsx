import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { PiLockSimpleBold, PiWarningCircleBold } from "react-icons/pi";
import type { AccessRole } from "@/lib/platform/contracts";
import { readDrafts, sessionDraftStorage, writeDrafts } from "@/lib/platform/client/onboarding-drafts";
import { PersonMarker } from "@/components/platform/ui";
import { BUTTON_VARIANTS } from "@/components/platform/ui/Button";
import { cx } from "@/components/platform/ui/cx";
import { REQUEST } from "./copy";
import { fillForm, fromStoredDrafts, isPristine, mergeDrafts, readForm } from "./request-drafts";
import { ACTION_BUTTON } from "./WelcomeChoices";
import { REQUEST_FIELDS, type RequestDraft, type RequestErrors, type RequestField } from "./welcome-flow";

type Props = {
  action: string;
  /** The access still to ask for, in role order: one section each. */
  roles: readonly AccessRole[];
  /** What was typed, when the server sent the form back. */
  draft: RequestDraft;
  errors: RequestErrors;
  /** Why the server could not send it, when the answers themselves were fine. */
  failure: string | null;
  /** This person's sessionStorage key for unsent text (S-O.2's `onboardingDraftKey`). */
  draftKey: string;
};

const NOTE_MAX = 600;
const TEXT_MAX = 200;
export const SUMMARY_ID = "request-problems";
export const fieldId = (field: RequestField) => `request-${field}`;
const describedBy = (...ids: (string | false)[]) => ids.filter(Boolean).join(" ") || undefined;

type FieldProps = {
  field: RequestField;
  label: string;
  optional?: boolean;
  hint?: string;
  error: string | undefined;
  /** Shown only once the script runs: a counter that cannot count is worse than none. */
  counter?: ReactNode;
  children: (control: { id: string; "aria-invalid"?: true; "aria-describedby"?: string }) => ReactNode;
};

function Field({ field, label, optional, hint, error, counter, children }: FieldProps) {
  const id = fieldId(field);
  const hintId = hint && `${id}-hint`;
  const errorId = error && `${id}-error`;
  return (
    <div className="request-field" data-invalid={error ? "" : undefined}>
      <label htmlFor={id} className="request-field__label">
        {label}
        {optional && <span className="request-field__optional"> {REQUEST.optional}</span>}
      </label>
      {hintId && (
        <p id={hintId} className="request-field__hint">
          {hint}
        </p>
      )}
      {error && (
        <p id={errorId || undefined} className="request-field__error">
          <PiWarningCircleBold aria-hidden="true" className="size-4 shrink-0" />
          {error}
        </p>
      )}
      {children({ id, "aria-invalid": error ? true : undefined, "aria-describedby": describedBy(hintId || false, errorId || false) })}
      {counter}
    </div>
  );
}

/**
 * S2, "A few details for the team": one section per access requested, one
 * button for all of them. Every answer is untrusted text an administrator
 * reads as written, so nothing here formats it.
 *
 * A plain form that works without JavaScript; the server re-renders it with
 * what was typed and a list of problems that takes focus. Hydration adds the
 * note counters, keeps unsent text for this tab (so "Back to your choices"
 * loses nothing) and holds the button once the form is on its way.
 */
export default function AccessRequestForm({ action, roles, draft, errors, failure, draftKey }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  // The server's first answer: later typing is the person's, so restoring a draft happens once.
  const first = useRef({ draft, draftKey });
  const [hydrated, setHydrated] = useState(false);
  const [sending, setSending] = useState(false);
  const [lengths, setLengths] = useState({ mentorNote: draft.mentorNote.length, institutionNote: draft.institutionNote.length });

  useEffect(() => {
    setHydrated(true);
    const form = formRef.current;
    // What the server sent back after a refusal always wins; only a fresh form takes the stored text.
    if (!form || !isPristine(first.current.draft)) return;
    const stored = fromStoredDrafts(readDrafts(sessionDraftStorage(), first.current.draftKey));
    if (isPristine(stored)) return;
    fillForm(form, stored);
    const current = readForm(form);
    setLengths({ mentorNote: current.mentorNote.length, institutionNote: current.institutionNote.length });
  }, []);
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) setSending(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  /** Keeps the roles on screen in this tab's drafts, or forgets them once they are on their way. */
  function store(form: HTMLFormElement, sent: boolean) {
    const storage = sessionDraftStorage();
    writeDrafts(storage, draftKey, mergeDrafts(readDrafts(storage, draftKey), readForm(form), roles, sent));
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (sending) {
      event.preventDefault();
      return;
    }
    // A refused post comes back with every answer in it, so the draft is no longer needed either way.
    store(event.currentTarget, true);
    setSending(true);
  }

  const problems = REQUEST_FIELDS.filter((field) => errors[field]);
  const mentor = roles.includes("MENTOR");
  const institution = roles.includes("INSTITUTION");

  const counter = (field: "mentorNote" | "institutionNote") =>
    hydrated && (
      <p className="request-field__counter" aria-hidden="true">
        {lengths[field]} / {NOTE_MAX}
      </p>
    );
  const count = (field: "mentorNote" | "institutionNote") => (event: FormEvent<HTMLTextAreaElement>) => {
    const { length } = event.currentTarget.value;
    setLengths((previous) => ({ ...previous, [field]: length }));
  };

  return (
    <form
      ref={formRef}
      method="post"
      action={action}
      noValidate
      onSubmit={onSubmit}
      onInput={(event) => store(event.currentTarget, false)}
      onChange={(event) => store(event.currentTarget, false)}
      className="request-form"
    >
      {(problems.length > 0 || failure) && (
        <div
          id={SUMMARY_ID}
          className="request-summary"
          role="alert"
          tabIndex={-1}
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the rejected form's problems, the page's focus target
          autoFocus
          aria-labelledby={problems.length > 0 ? `${SUMMARY_ID}-title` : undefined}
        >
          {problems.length > 0 ? (
            <>
              <h2 id={`${SUMMARY_ID}-title`} className="request-summary__title">{REQUEST.errorTitle}</h2>
              <ul className="request-summary__list">
                {problems.map((field) => (
                  <li key={field}>
                    <a href={`#${fieldId(field)}`}>{errors[field]}</a>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="request-summary__failure">{failure}</p>
          )}
        </div>
      )}

      {mentor && (
        <section className="request-section" aria-labelledby="request-mentor-title">
          <h2 id="request-mentor-title" className="request-section__title">
            <PersonMarker kind="mentor" />
            {REQUEST.sections.MENTOR}
          </h2>
          <Field field="mentorNote" label={REQUEST.mentorNote} hint={REQUEST.noteLength} error={errors.mentorNote} counter={counter("mentorNote")}>
            {(control) => (
              <textarea {...control} name="mentorNote" required rows={4} maxLength={NOTE_MAX} defaultValue={draft.mentorNote}
                onInput={count("mentorNote")} className="request-input request-input--area" />
            )}
          </Field>
          <Field field="mentorLink" label={REQUEST.mentorLink} optional error={errors.mentorLink}>
            {(control) => (
              <input {...control} name="mentorLink" type="url" inputMode="url" autoComplete="url" placeholder="https://"
                defaultValue={draft.mentorLink} className="request-input" />
            )}
          </Field>
        </section>
      )}

      {institution && (
        <section className="request-section" aria-labelledby="request-institution-title">
          <h2 id="request-institution-title" className="request-section__title">
            <PersonMarker kind="institution" />
            {REQUEST.sections.INSTITUTION}
          </h2>
          <Field field="organisation" label={REQUEST.organisation} error={errors.organisation}>
            {(control) => (
              <input {...control} name="organisation" type="text" required maxLength={TEXT_MAX} autoComplete="organization"
                defaultValue={draft.organisation} className="request-input" />
            )}
          </Field>
          <Field field="organisationRole" label={REQUEST.organisationRole} optional error={errors.organisationRole}>
            {(control) => (
              <input {...control} name="organisationRole" type="text" maxLength={TEXT_MAX} autoComplete="organization-title"
                defaultValue={draft.organisationRole} className="request-input" />
            )}
          </Field>
          <Field field="institutionNote" label={REQUEST.institutionNote} hint={`${REQUEST.institutionNoteHint} ${REQUEST.noteLength}`}
            error={errors.institutionNote} counter={counter("institutionNote")}>
            {(control) => (
              <textarea {...control} name="institutionNote" required rows={4} maxLength={NOTE_MAX} defaultValue={draft.institutionNote}
                onInput={count("institutionNote")} className="request-input request-input--area" />
            )}
          </Field>
          <Field field="institutionLink" label={REQUEST.institutionLink} optional error={errors.institutionLink}>
            {(control) => (
              <input {...control} name="institutionLink" type="url" inputMode="url" autoComplete="url" placeholder="https://"
                defaultValue={draft.institutionLink} className="request-input" />
            )}
          </Field>
          <div className="request-ack" data-invalid={errors.scope ? "" : undefined}>
            {errors.scope && (
              <p id={`${fieldId("scope")}-error`} className="request-field__error">
                <PiWarningCircleBold aria-hidden="true" className="size-4 shrink-0" />
                {errors.scope}
              </p>
            )}
            <label className="request-ack__label">
              <input
                id={fieldId("scope")}
                type="checkbox"
                name="scope"
                value="yes"
                required
                defaultChecked={draft.scope}
                aria-invalid={errors.scope ? true : undefined}
                aria-describedby={errors.scope ? `${fieldId("scope")}-error` : undefined}
                className="request-ack__input"
              />
              <span>{REQUEST.scope}</span>
            </label>
          </div>
        </section>
      )}

      <div className="request-send">
        <button type="submit" aria-disabled={sending || undefined} className={cx(ACTION_BUTTON, BUTTON_VARIANTS.primary)}>
          {roles.length > 1 ? REQUEST.sendBoth : REQUEST.send}
        </button>
        <p className="request-send__privacy">
          <PiLockSimpleBold aria-hidden="true" className="size-4 shrink-0" />
          {REQUEST.privacy}
        </p>
      </div>
    </form>
  );
}
