import type { ReactNode } from "react";
import { PiCheckCircle, PiInfo, PiWarning, PiWarningOctagon } from "react-icons/pi";
import { cx } from "./cx";
import { FOCUS_RING } from "./recipes";
import { filled } from "./slot";

export type NoticeTone = "info" | "success" | "warning" | "danger";

/** How a screen reader hears the notice arrive. `none` is part of the page, read in order. */
export type NoticeAnnounce = "assertive" | "polite" | "none";

type NoticeProps = {
  tone?: NoticeTone;
  /** The point in a few words: "We couldn't send your request". */
  title?: ReactNode;
  /** What happened and what to do next. */
  children?: ReactNode;
  /** A way forward, such as a link to try again. Buttons or links, never more than two. */
  actions?: ReactNode;
  /**
   * Defaults follow the tone: a failure interrupts (`alert`), a confirmation
   * waits its turn (`status`), and information or a caution that is simply
   * part of the page is not announced at all.
   */
  announce?: NoticeAnnounce;
  id?: string;
  /**
   * Take focus when the page loads: the notice of a rejected submit, so the
   * reader lands on what went wrong. Server-rendered as `autofocus`, so it
   * works before any script; it makes the notice focusable (`tabindex=-1`).
   */
  focusOnLoad?: boolean;
  /** Focusable by script without joining the tab order, for a page that moves focus itself. */
  tabIndex?: -1;
  className?: string;
};

/*
 * Each tone is a faint tint of its own ink with a firmer edge, the same
 * recipe at every tone, so a notice never shouts by colour alone: the icon and
 * the words carry the meaning too (WCAG 1.4.1). contrast.test.ts reads these.
 */
export const NOTICE_TONES: Record<NoticeTone, { frame: string; ink: string }> = {
  info: { frame: "border-hairline bg-ink-primary/6", ink: "text-ink-primary" },
  success: { frame: "border-success-ink/40 bg-success-ink/8", ink: "text-success-ink" },
  warning: { frame: "border-warning-ink/40 bg-warning-ink/8", ink: "text-warning-ink" },
  danger: { frame: "border-danger-ink/40 bg-danger-ink/8", ink: "text-danger-ink" },
};

const ICONS = { info: PiInfo, success: PiCheckCircle, warning: PiWarning, danger: PiWarningOctagon } as const;

/** What each tone is called out loud, so the icon's meaning is never lost. */
const SPOKEN: Record<NoticeTone, string> = {
  info: "Note",
  success: "Done",
  warning: "Warning",
  danger: "Problem",
};

const DEFAULT_ANNOUNCE: Record<NoticeTone, NoticeAnnounce> = {
  info: "none",
  success: "polite",
  warning: "none",
  danger: "assertive",
};

const ROLE: Record<NoticeAnnounce, "alert" | "status" | undefined> = {
  assertive: "alert",
  polite: "status",
  none: undefined,
};

/**
 * A message about the page or what just happened on it: a rejected form, a
 * saved change, a space that is read-only. One per region, at the top of what
 * it is about. A field's own error belongs under that field instead.
 */
export default function Notice({ tone = "info", title, children, actions, announce, id, focusOnLoad, tabIndex, className }: NoticeProps) {
  const Icon = ICONS[tone];
  const { frame, ink } = NOTICE_TONES[tone];
  const role = ROLE[announce ?? DEFAULT_ANNOUNCE[tone]];
  /*
   * A notice that takes focus (a confirm step, a rejected form) or that a page
   * points at by its id is a region named by its title, so the reader who lands
   * on it, or is sent to it, hears what it is. Other notices stay part of the
   * page, so a page with several does not gain a landmark for each. An alert or
   * a status is read by its content as it arrives, so it takes no name that
   * could replace it.
   */
  const titleId = id && title ? `${id}-title` : undefined;
  const regionName = titleId ? { "aria-labelledby": titleId } : typeof title === "string" ? { "aria-label": title } : null;
  const landmark = Boolean(focusOnLoad || tabIndex === -1 || id);
  const named = !role && landmark && regionName ? { role: "region" as const, ...regionName } : { role };

  return (
    <div
      id={id}
      // oxlint-disable-next-line jsx-a11y/no-autofocus -- focus goes to the error the reader must fix, as the form-error pattern requires.
      autoFocus={focusOnLoad || undefined}
      tabIndex={focusOnLoad ? -1 : tabIndex}
      {...named}
      data-notice={tone}
      className={cx("flex min-w-0 gap-3 rounded-xl border px-4 py-3 text-sm leading-relaxed", frame, (focusOnLoad || tabIndex === -1) && FOCUS_RING, className)}
    >
      <Icon aria-hidden className={cx("mt-0.5 size-5 shrink-0", ink)} />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="sr-only">{`${SPOKEN[tone]}: `}</span>
        {title && (
          <p id={titleId} className={cx("m-0 font-semibold", ink)}>
            {title}
          </p>
        )}
        {filled(children) && <div className={cx("min-w-0 break-words", title ? "text-ink-secondary" : "text-ink-primary")}>{children}</div>}
        {filled(actions) && <div className="mt-2 flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
  );
}
