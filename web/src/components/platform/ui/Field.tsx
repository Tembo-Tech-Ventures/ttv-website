import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { PiCaretDown } from "react-icons/pi";
import { cx } from "./cx";
import { CHOICE_BOX, CONTROL, CONTROL_HEIGHT, FIELD_ERROR, HINT, HINT_ON_TINT, LABEL } from "./recipes";
// oxlint-disable-next-line import/no-unassigned-import -- the drawn checkbox and radio (CHOICE_BOX).
import "./choice.css";

/*
 * Form fields: a label above its control, an optional hint under the label,
 * and, after a rejected submit, an error under the control that says how to
 * fix it. They are plain form controls, so a server-rendered `<form
 * method="POST">` works with no JavaScript, and they render from `.astro` pages
 * without a `client:` directive.
 *
 * Ids are explicit (`id`, else `name`), never generated: Astro renders each
 * React component as its own root, where `useId` would hand two fields on one
 * page the same id.
 */

type FieldText = {
  /** What the field is, in words: "Your name", not "Name *". */
  label: ReactNode;
  /** What it is for or what it takes, read after the label. */
  hint?: ReactNode;
  /** What is wrong with the value, after a submit. Marks the control invalid. */
  error?: ReactNode;
  /** Says "(optional)" after the label. Ask only for what you need, and mark what can be skipped. */
  optional?: boolean;
};

/** A value as part of an id: no spaces, which would split an `aria-describedby` list. */
function idPart(value: string): string {
  return value.trim().replace(/[^A-Za-z0-9_-]+/g, "-") || "blank";
}

/** The id every part of one field hangs off. */
export function fieldId(id: string | undefined, name: string | undefined): string {
  const resolved = id ?? name;
  if (!resolved) throw new Error("A field needs an id or a name: its label, hint and error point at it.");
  return resolved;
}

/**
 * The control's links to its hint and error, so both are read with it, after
 * any descriptions of the caller's own (a character count, say).
 */
export function fieldAria(id: string, { hint, error }: Pick<FieldText, "hint" | "error">, own?: string) {
  const describedBy = [own, hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(" ");
  return {
    "aria-describedby": describedBy || undefined,
    "aria-invalid": error ? (true as const) : undefined,
  };
}

function Label({ htmlFor, label, optional }: { htmlFor?: string; label: ReactNode; optional?: boolean }) {
  const content = (
    <>
      {label}
      {optional && <span className="font-normal text-ink-muted"> (optional)</span>}
    </>
  );
  return htmlFor ? (
    <label htmlFor={htmlFor} className={LABEL}>
      {content}
    </label>
  ) : (
    <span className={LABEL}>{content}</span>
  );
}

/** On a tint (a chosen card), the hint takes the secondary ink: the muted one only clears on bare sheets and cards. */
function Hint({ id, children, onTint = false }: { id: string; children: ReactNode; onTint?: boolean }) {
  return (
    <p id={`${id}-hint`} className={cx(onTint ? HINT_ON_TINT : HINT, "m-0")}>
      {children}
    </p>
  );
}

function ErrorText({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={`${id}-error`} data-field-error className={cx(FIELD_ERROR, "m-0")}>
      {children}
    </p>
  );
}

/** One field's frame: label, hint, the control, and its error. */
function Frame({ id, label, hint, error, optional, children, className }: FieldText & { id: string; children: ReactNode; className?: string }) {
  return (
    <div data-field={id} data-invalid={error ? true : undefined} className={cx("flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={id} label={label} optional={optional} />
      {hint && <Hint id={id}>{hint}</Hint>}
      {children}
      {error && <ErrorText id={id}>{error}</ErrorText>}
    </div>
  );
}

type TextFieldProps = FieldText &
  Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "type"> & {
    type?: "text" | "email" | "url" | "tel" | "search" | "password" | "number" | "date" | "time";
    className?: string;
  };

/** A one-line text field. */
export function TextField({ label, hint, error, optional, id, name, type = "text", className, ...rest }: TextFieldProps) {
  const fid = fieldId(id, name);
  return (
    <Frame id={fid} label={label} hint={hint} error={error} optional={optional} className={className}>
      <input {...rest} {...fieldAria(fid, { hint, error }, rest["aria-describedby"])} id={fid} name={name} type={type} className={cx(CONTROL, CONTROL_HEIGHT)} />
    </Frame>
  );
}

type PrefixFieldProps = TextFieldProps & {
  /** The fixed start of the value, shown in front of the control and never sent: "tembotechventures.com/talent/". */
  prefix: string;
};

/**
 * A text field whose value continues something fixed: a profile's handle
 * after the site's address, a post's slug after its path. The prefix is part
 * of what the reader sees and hears, not of what the form sends. On a narrow
 * screen it wraps above the control rather than squeeze it.
 */
export function PrefixField({ label, hint, error, optional, id, name, type = "text", prefix, className, ...rest }: PrefixFieldProps) {
  const fid = fieldId(id, name);
  return (
    <Frame id={fid} label={label} hint={hint} error={error} optional={optional} className={className}>
      <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span id={`${fid}-prefix`} data-prefix className="min-w-0 text-[0.9375rem] break-all text-ink-secondary">
          {prefix}
        </span>
        <input
          {...rest}
          {...fieldAria(fid, { hint, error }, [`${fid}-prefix`, rest["aria-describedby"]].filter(Boolean).join(" "))}
          id={fid}
          name={name}
          type={type}
          className={cx(CONTROL, CONTROL_HEIGHT, "min-w-40 flex-1 basis-40")}
        />
      </span>
    </Frame>
  );
}

type FileFieldProps = FieldText &
  Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "type" | "value" | "defaultValue"> & {
    className?: string;
  };

/**
 * Choosing a file to upload: the browser's own picker, its button drawn as a
 * quiet one, and the file's name beside it. Say in `hint` what it takes (the
 * kinds and the size limit), because a rejected file is a wasted upload. The
 * form posts as `multipart/form-data`.
 */
export function FileField({ label, hint, error, optional, id, name, className, ...rest }: FileFieldProps) {
  const fid = fieldId(id, name);
  return (
    <Frame id={fid} label={label} hint={hint} error={error} optional={optional} className={className}>
      <input
        {...rest}
        {...fieldAria(fid, { hint, error }, rest["aria-describedby"])}
        id={fid}
        name={name}
        type="file"
        className={cx(
          CONTROL,
          "min-h-11 cursor-pointer py-1.5 pl-1.5 leading-8 text-ink-secondary",
          "file:mr-3 file:h-8 file:cursor-pointer file:rounded-lg file:border file:border-hairline file:bg-ink-primary/6 file:px-3 file:text-[0.8125rem] file:font-semibold file:text-ink-primary hover:file:bg-ink-primary/10",
        )}
      />
    </Frame>
  );
}

type TextAreaFieldProps = FieldText & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "className"> & { className?: string };

/** Several lines of text: a note, a description, an answer. */
export function TextAreaField({ label, hint, error, optional, id, name, rows = 4, className, ...rest }: TextAreaFieldProps) {
  const fid = fieldId(id, name);
  return (
    <Frame id={fid} label={label} hint={hint} error={error} optional={optional} className={className}>
      <textarea
        {...rest}
        {...fieldAria(fid, { hint, error }, rest["aria-describedby"])}
        id={fid}
        name={name}
        rows={rows}
        className={cx(CONTROL, "min-h-24 resize-y py-2.5 leading-relaxed")}
      />
    </Frame>
  );
}

export type FieldOption = { value: string; label: string; disabled?: boolean };

type SelectFieldProps = FieldText &
  Omit<SelectHTMLAttributes<HTMLSelectElement>, "className" | "children" | "multiple"> & {
    options: readonly FieldOption[];
    /** A first, empty choice such as "Choose a month", for a field with no default. */
    placeholder?: string;
    className?: string;
  };

/**
 * One choice from a list too long for radios. The native select, so every
 * platform keeps its own picker; options are a prop rather than children so the
 * field renders the same from Astro as from React.
 */
export function SelectField({ label, hint, error, optional, id, name, options, placeholder, className, ...rest }: SelectFieldProps) {
  const fid = fieldId(id, name);
  return (
    <Frame id={fid} label={label} hint={hint} error={error} optional={optional} className={className}>
      <span className="relative flex">
        <select
          {...rest}
          {...fieldAria(fid, { hint, error }, rest["aria-describedby"])}
          id={fid}
          name={name}
          className={cx(CONTROL, CONTROL_HEIGHT, "cursor-pointer appearance-none pr-10")}
        >
          {placeholder !== undefined && <option value="">{placeholder}</option>}
          {options.map((option) => (
            <option key={option.value} value={option.value} disabled={option.disabled}>
              {option.label}
            </option>
          ))}
        </select>
        <PiCaretDown aria-hidden className="pointer-events-none absolute top-1/2 right-3.5 size-4 -translate-y-1/2 text-ink-secondary" />
      </span>
    </Frame>
  );
}

type ChoiceProps = Omit<InputHTMLAttributes<HTMLInputElement>, "className" | "type"> & {
  label: ReactNode;
  hint?: ReactNode;
  /** What is wrong, for a box that has to be ticked: "Agree to the code of conduct to post". */
  error?: ReactNode;
  className?: string;
};

function Choice({ type, label, hint, error, id, name, value, className, ...rest }: ChoiceProps & { type: "checkbox" | "radio" }) {
  // One of several boxes sharing a name is told apart by its value, made safe for an id.
  const fid = fieldId(id, name && value !== undefined ? `${name}-${idPart(String(value))}` : name);
  return (
    <div data-choice={type} data-invalid={error ? true : undefined} className={cx("flex min-w-0 items-start gap-3", className)}>
      <input
        {...rest}
        {...fieldAria(fid, { hint, error }, rest["aria-describedby"])}
        aria-invalid={error || rest["aria-invalid"] ? true : undefined}
        id={fid}
        name={name}
        value={value}
        type={type}
        className={CHOICE_BOX}
      />
      <span className="flex min-w-0 flex-col gap-0.5">
        <label htmlFor={fid} className="cursor-pointer text-sm font-medium text-ink-primary">
          {label}
        </label>
        {hint && <Hint id={fid}>{hint}</Hint>}
        {error && <ErrorText id={fid}>{error}</ErrorText>}
      </span>
    </div>
  );
}

type ChoiceCardProps = ChoiceProps & {
  type?: "radio" | "checkbox";
  /** A small decorative mark before the words, such as a `PersonMarker` for who the choice makes you. */
  mark?: ReactNode;
  /** A line under the hint that is part of the choice's description, such as a status chip ("Needs approval"). */
  detail?: ReactNode;
};

/**
 * A choice that needs a sentence to be understood, set as a card: "Learning
 * in a cohort", "Mentoring". The whole card is the label, so it is one large
 * target; the chosen card takes the peach edge and a faint peach lift, and
 * says so with its box as well as its colour.
 */
export function ChoiceCard({ type = "radio", label, hint, error, mark, detail, id, name, value, className, ...rest }: ChoiceCardProps) {
  const fid = fieldId(id, name && value !== undefined ? `${name}-${idPart(String(value))}` : name);
  return (
    <label
      htmlFor={fid}
      data-choice-card={type}
      data-invalid={error ? true : undefined}
      className={cx(
        "flex min-w-0 cursor-pointer items-start gap-3 rounded-[1.125rem] border border-hairline p-4 transition-colors duration-150 motion-reduce:transition-none",
        "bg-ink-primary/4 hover:border-ink-primary/45 has-checked:border-peach-ink has-checked:bg-primary/10 has-disabled:cursor-not-allowed has-disabled:opacity-60",
        "has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-peach-ink",
        className,
      )}
    >
      <input
        {...rest}
        {...fieldAria(fid, { hint, error }, [rest["aria-describedby"], detail ? `${fid}-detail` : null].filter(Boolean).join(" ") || undefined)}
        aria-invalid={error || rest["aria-invalid"] ? true : undefined}
        // Named by its title alone; the hint and detail describe it, so a card is not read as one long name.
        aria-labelledby={rest["aria-labelledby"] ?? `${fid}-label`}
        id={fid}
        name={name}
        value={value}
        type={type}
        className={CHOICE_BOX}
      />
      {mark && (
        <span aria-hidden="true" className="inline-flex shrink-0">
          {mark}
        </span>
      )}
      <span className="flex min-w-0 flex-col gap-1">
        <span id={`${fid}-label`} className="text-sm font-semibold text-ink-primary">
          {label}
        </span>
        {hint && (
          <Hint id={fid} onTint>
            {hint}
          </Hint>
        )}
        {detail && (
          <span id={`${fid}-detail`} className="mt-1 flex flex-wrap gap-2">
            {detail}
          </span>
        )}
        {error && <ErrorText id={fid}>{error}</ErrorText>}
      </span>
    </label>
  );
}

/** A yes-or-no question, or one of several independent ones in a `ChoiceGroup`. */
export function Checkbox(props: ChoiceProps) {
  return <Choice {...props} type="checkbox" />;
}

type ChoiceGroupProps = FieldText & {
  /** The group's name; each radio's id is `name-value`. */
  name: string;
  /** Radios: exactly one of them. Checkboxes: any of them. */
  type?: "radio" | "checkbox";
  options: ReadonlyArray<FieldOption & { hint?: string }>;
  /** The checked value or values. */
  defaultValue?: string | readonly string[];
  required?: boolean;
  /** `cards` when each answer needs a sentence: a `ChoiceCard` each, two to a row from 40rem. */
  appearance?: "rows" | "cards";
  className?: string;
};

/**
 * A question answered by choosing: a fieldset whose legend is the question,
 * radios for one answer and checkboxes for several. Under seven options and
 * the answers are worth reading side by side; past that, a select.
 */
export function ChoiceGroup({ label, hint, error, optional, name, type = "radio", options, defaultValue, required, appearance = "rows", className }: ChoiceGroupProps) {
  const Option = appearance === "cards" ? ChoiceCard : Choice;
  const checked = new Set(typeof defaultValue === "string" ? [defaultValue] : (defaultValue ?? []));
  const describedBy = fieldAria(name, { hint, error })["aria-describedby"];
  return (
    <fieldset
      data-field={name}
      data-invalid={error ? true : undefined}
      aria-describedby={describedBy}
      className={cx("m-0 flex min-w-0 flex-col gap-1.5 border-0 p-0", className)}
    >
      <legend className="mb-0 p-0">
        <Label label={label} optional={optional} />
      </legend>
      {hint && <Hint id={name}>{hint}</Hint>}
      <div className={appearance === "cards" ? "mt-1 grid gap-3 sm:grid-cols-2" : "mt-1 flex flex-col gap-3"}>
        {options.map((option) => (
          <Option
            key={option.value}
            type={type}
            name={name}
            value={option.value}
            label={option.label}
            hint={option.hint}
            disabled={option.disabled}
            defaultChecked={checked.has(option.value)}
            required={type === "radio" ? required : undefined}
            aria-invalid={error ? true : undefined}
          />
        ))}
      </div>
      {error && <ErrorText id={name}>{error}</ErrorText>}
    </fieldset>
  );
}
