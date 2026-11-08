import type { ReactNode } from "react";
import Button from "./Button";
import ButtonLink from "./ButtonLink";
import { cx } from "./cx";
import Notice from "./Notice";

type ConfirmStepProps = {
  /** The question, naming the thing: "Remove Wanjiku Mwangi from Cohort 05?" */
  title: ReactNode;
  /** What happens, and whether it can be undone. */
  children?: ReactNode;
  /** The words on the danger button, saying what happens: "Remove from cohort". */
  confirmLabel: string;
  /** Where Cancel goes: the same page without the step (`withoutConfirm`). */
  cancelHref: string;
  /** Where the form posts; the page itself when left out. */
  action?: string;
  /** Hidden fields the POST handler needs: the intent and the row's id. */
  fields?: Readonly<Record<string, string>>;
  id?: string;
  /** Off only where the step is shown as an example, as the style guide does. */
  focusOnLoad?: boolean;
  className?: string;
};

/**
 * The step between pressing a destructive action and it happening, without
 * JavaScript: a warning notice that says what will happen, then a form whose
 * danger button does it and a ghost Cancel that goes back. The notice takes
 * focus when it appears, so the reader lands on the question. The buttons sit
 * under the notice rather than on its tint, where a hovered danger button
 * would fall below 4.5:1. The POST handler still checks who may do this: the
 * step only asks.
 */
const NO_FIELDS: Readonly<Record<string, string>> = {};

export default function ConfirmStep({
  title,
  children,
  confirmLabel,
  cancelHref,
  action,
  fields = NO_FIELDS,
  id,
  focusOnLoad = true,
  className,
}: ConfirmStepProps) {
  return (
    <div data-confirm-step className={cx("flex min-w-0 flex-col gap-3", className)}>
      <Notice tone="warning" title={title} id={id} focusOnLoad={focusOnLoad}>
        {children}
      </Notice>
      <form method="post" action={action} className="flex flex-wrap gap-2">
        {Object.entries(fields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <Button variant="danger" type="submit">
          {confirmLabel}
        </Button>
        <ButtonLink variant="ghost" href={cancelHref}>
          Cancel
        </ButtonLink>
      </form>
    </div>
  );
}
