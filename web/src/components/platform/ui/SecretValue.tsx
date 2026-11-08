import type { ReactNode } from "react";
import Button from "./Button";
import Card from "./Card";
import { cx } from "./cx";

type SecretValueProps = {
  /** The heading, naming what was made: "Your new token: Nightly check". An h2. */
  title: ReactNode;
  /** The secret itself, shown once. */
  value: string;
  /** The id of the element holding the value; the copy button names it in `data-copy-secret`. */
  id: string;
  /** What to do with it now: copy it, where to keep it, never where to put it. */
  children: ReactNode;
  /** The copy button's words, saying what it copies: "Copy token". */
  copyLabel: string;
  /** How to use it, under the value: "Send it as the header …". */
  usage?: ReactNode;
  className?: string;
};

/**
 * A secret shown once, just after it was made: a token, a key. It sits in a
 * card under a heading that names it, with what to do now, the value in mono
 * (wrapping anywhere, so it never scrolls sideways) and a quiet copy button, so
 * the page's one primary stays the form that made it. The button needs the
 * page's script, bound to `[data-copy-secret]`; without script the value is
 * plain text the reader selects.
 */
export default function SecretValue({ title, value, id, children, copyLabel, usage, className }: SecretValueProps) {
  const headingId = `${id}-title`;
  return (
    <Card as="section" aria-labelledby={headingId} className={cx("flex min-w-0 flex-col gap-4", className)}>
      <div className="flex flex-col gap-1">
        <h2 id={headingId} className="m-0 font-body text-lg text-ink-primary">
          {title}
        </h2>
        <div className="max-w-prose text-sm text-ink-secondary">{children}</div>
      </div>
      <div className="flex min-w-0 flex-col gap-3 sm:flex-row sm:items-start">
        <code id={id} className="min-w-0 flex-1 rounded-xl bg-ink-primary/6 p-3 font-mono text-sm break-all text-ink-primary">
          {value}
        </code>
        <Button type="button" variant="quiet" data-copy-secret={id}>
          {copyLabel}
        </Button>
      </div>
      {usage && <p className="m-0 text-sm text-ink-secondary">{usage}</p>}
    </Card>
  );
}
