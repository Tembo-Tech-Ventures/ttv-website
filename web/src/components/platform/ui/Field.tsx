import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from "react";
import { PiCaretDown } from "react-icons/pi";
import { cx } from "./cx";
import { CHOICE_BOX, CONTROL, CONTROL_HEIGHT, FIELD_ERROR, HINT, LABEL } from "./recipes";

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

function Hint({ id, children }: { id: string; children: ReactNode }) {
  return (
    <p id={`${id}-hint`} className={cx(HINT, "m-0")}>
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
  className?: string;
};

/**
 * A question answered by choosing: a fieldset whose legend is the question,
 * radios for one answer and checkboxes for several. Under seven options and
 * the answers are worth reading side by side; past that, a select.
 */
export function ChoiceGroup({ label, hint, error, optional, name, type = "radio", options, defaultValue, required, className }: ChoiceGroupProps) {
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
      <div className="mt-1 flex flex-col gap-3">
        {options.map((option) => (
          <Choice
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
