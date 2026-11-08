import { cx } from "./cx";

/*
 * The kit's class recipes: the one place each control's look is written down.
 *
 * The React primitives are built from these, and so is anything that cannot
 * be one of them: a `.astro` form's submit button, a link that must look like
 * a button inside server-rendered copy. Reach for the component first; take a
 * recipe only where the component cannot go, and never restate its classes.
 * docs/design-system/components.md says which is which.
 */

/** Shared by every focusable primitive, so focus looks the same everywhere. */
export const FOCUS_RING =
  "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-peach-ink";

/**
 * The same ring drawn inside the edge, for rows that fill a menu or a list:
 * an outer ring would be clipped by the panel, or run into the next row.
 */
export const INSET_FOCUS_RING =
  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-peach-ink";

export type ButtonVariant = "primary" | "quiet" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-primary text-dark hover:bg-peach-ink",
  quiet: "border border-hairline bg-ink-primary/6 text-ink-primary hover:bg-ink-primary/10",
  ghost: "text-ink-secondary hover:bg-ink-primary/7 hover:text-ink-primary",
  danger: "border border-danger-ink/50 text-danger-ink hover:bg-danger-ink/8",
};

/*
 * Every variant goes quiet the same way when it cannot be used, rather than
 * fading its own colour: half-opacity peach on teal reads as brown, not "off".
 */
export const BUTTON_DISABLED = "cursor-not-allowed border border-hairline bg-transparent text-ink-muted";

/** `lg` is the full 44px target on every pointer, for actions people reach with a thumb. */
export const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "h-8 gap-1.5 rounded-lg px-3 text-[0.8125rem]",
  md: "h-10 gap-2 rounded-xl px-4 text-sm",
  lg: "h-11 gap-2 rounded-xl px-4 text-sm",
};

const BUTTON_BASE =
  "inline-flex shrink-0 items-center justify-center font-semibold whitespace-nowrap transition-colors duration-150 motion-reduce:transition-none pointer-coarse:min-h-11";

export type ButtonRecipe = {
  variant?: ButtonVariant;
  size?: ButtonSize;
  disabled?: boolean;
  className?: string;
};

/** A button's classes, for a `<button>` or an `<a>` that cannot be `Button` or `ButtonLink`. */
export function buttonClass({ variant = "quiet", size = "md", disabled = false, className }: ButtonRecipe = {}): string {
  return cx(BUTTON_BASE, BUTTON_SIZES[size], disabled ? BUTTON_DISABLED : BUTTON_VARIANTS[variant], FOCUS_RING, className);
}

/** A pill: a filter toggle, or one link in a row of them. Pressed and current pills are ink. */
export function pillClass(selected: boolean, className?: string): string {
  return cx(
    "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3 text-[0.8125rem] font-semibold whitespace-nowrap transition-colors duration-150 motion-reduce:transition-none pointer-coarse:min-h-11",
    selected ? "bg-ink-primary text-dark" : "text-ink-secondary hover:bg-ink-primary/7 hover:text-ink-primary",
    FOCUS_RING,
    className,
  );
}

/*
 * A text control's frame. The border is the control's only edge on the sheet,
 * so it carries 3:1 against every sheet and card (WCAG 1.4.11, checked in
 * contrast.test.ts); the well behind the words is the ground showing through.
 * An invalid control takes the danger ink, and so does its message. The dark
 * colour scheme keeps the browser's own parts (an empty radio, a select's
 * list, a date picker) dark like the page around them.
 */
export const CONTROL = cx(
  "w-full min-w-0 scheme-dark rounded-xl border border-ink-primary/45 bg-ground/40 px-3.5 text-[0.9375rem] text-ink-primary placeholder:text-ink-muted",
  "transition-colors duration-150 motion-reduce:transition-none hover:border-ink-primary/60 focus-visible:border-peach-ink",
  "aria-invalid:border-danger-ink disabled:cursor-not-allowed disabled:border-hairline disabled:text-ink-muted",
  FOCUS_RING,
);

/** Single-line controls are a 44px target on every pointer: forms are where thumbs land. */
export const CONTROL_HEIGHT = "h-11";

/** A checkbox or radio's box. The native control, tinted and dark, so it keeps every platform behaviour. */
export const CHOICE_BOX = cx("mt-0.5 size-5 shrink-0 cursor-pointer scheme-dark accent-peach-ink disabled:cursor-not-allowed", FOCUS_RING);

/** A field's label: Maven Pro, semibold, always above its control. */
export const LABEL = "text-sm font-semibold text-ink-primary";

/** The quiet line under a label that says what a field is for or what it takes. */
export const HINT = "text-[0.8125rem] leading-snug text-ink-muted";

/** What went wrong with one field, in words that say how to fix it. */
export const FIELD_ERROR = "text-[0.8125rem] leading-snug font-semibold text-danger-ink";
