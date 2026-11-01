import { useEffect, useId, useState, type FormEvent } from "react";
import { PiArrowRightBold, PiCheckBold, PiCheckCircleBold, PiHourglassMediumBold, PiInfoBold } from "react-icons/pi";
import { Chip, PersonMarker } from "@/components/platform/ui";
import { BUTTON_VARIANTS, FOCUS_RING } from "@/components/platform/ui/Button";
import { cx } from "@/components/platform/ui/cx";
import { CHOICES, WELCOME, type Choice, type ChoiceIntent } from "./copy";
import type { ChoiceStatus } from "./welcome-flow";

export const WELCOME_TITLE_ID = "welcome-title";
export const CHOICES_ERROR_ID = "welcome-choices-error";
/** The first card's checkbox, where the error summary's link lands. */
export const FIRST_CHOICE_ID = `welcome-choice-${CHOICES[0]!.intent.toLowerCase()}`;

type Props = {
  /** Where the form posts: the step's own URL. */
  action: string;
  /** The cards ticked when the page opens. */
  selected: readonly ChoiceIntent[];
  /** Where a person already stands on the cards that need approval. */
  statuses: Partial<Record<ChoiceIntent, ChoiceStatus>>;
  /** The server's answer to the last post, when it refused it. */
  error: string | null;
};

export const ACTION_BUTTON = cx(
  "inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-xl px-5 text-[0.9375rem] font-bold whitespace-nowrap",
  "transition-colors duration-150 motion-reduce:transition-none",
  FOCUS_RING,
);

function StatusChip({ choice, status }: { choice: Choice; status: ChoiceStatus | undefined }) {
  if (status === "active") return <Chip tone="peach" icon={<PiCheckCircleBold className="size-3.5" />}>{WELCOME.active}</Chip>;
  if (status === "pending") return <Chip tone="ring" icon={<PiHourglassMediumBold className="size-3.5" />}>{WELCOME.pending}</Chip>;
  return choice.needsApproval
    ? <Chip tone="ring" icon={<PiHourglassMediumBold className="size-3.5" />}>{WELCOME.needsApproval}</Chip>
    : <Chip tone="peach">{WELCOME.open}</Chip>;
}

/**
 * S1, "How will you take part?": three cards a person may combine, and a
 * separate "just looking around" that stands alone.
 *
 * A plain form: each card is a label around a real checkbox, so it works
 * before and without JavaScript, and the selected look comes from CSS
 * (`:has(:checked)`), not from state. Hydration adds the count in the phone's
 * action bar, the "choose at least one" check before posting, and holding
 * the buttons once the form is on its way.
 */
export default function WelcomeChoices({ action, selected, statuses, error }: Props) {
  const [chosen, setChosen] = useState<ReadonlySet<ChoiceIntent>>(() => new Set(selected));
  const [problem, setProblem] = useState<string | null>(error);
  const [hydrated, setHydrated] = useState(false);
  const [sending, setSending] = useState(false);
  const idBase = useId();

  useEffect(() => setHydrated(true), []);
  // Coming back through the browser's history restores the page as it was left: let it be pressed again.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) setSending(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  function toggle(intent: ChoiceIntent, on: boolean) {
    setChosen((previous) => {
      const next = new Set(previous);
      if (on) next.add(intent);
      else next.delete(intent);
      return next;
    });
    if (on) setProblem(null);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (sending) {
      event.preventDefault();
      return;
    }
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.value !== "explore" && chosen.size === 0) {
      event.preventDefault();
      setProblem(WELCOME.required);
      return;
    }
    setSending(true);
  }

  const count = chosen.size;

  return (
    <form method="post" action={action} noValidate onSubmit={onSubmit} className="welcome-form">
      <fieldset
        className="welcome-choices"
        aria-labelledby={WELCOME_TITLE_ID}
        aria-describedby={problem ? CHOICES_ERROR_ID : undefined}
      >
        {/*
          Always present, so a problem found before posting is announced as it appears. One the
          server sent back takes focus as the page opens (rendered `autofocus`, so without JavaScript too).
        */}
        <p
          id={CHOICES_ERROR_ID}
          role="alert"
          tabIndex={-1}
          // oxlint-disable-next-line jsx-a11y/no-autofocus -- the rejected form's one problem, the page's focus target
          autoFocus={error !== null}
          className={problem ? "welcome-error" : "sr-only"}
        >
          {problem}
        </p>
        {CHOICES.map((choice) => {
          const key = choice.intent.toLowerCase();
          const titleId = `${idBase}-${key}-title`;
          const bodyId = `${idBase}-${key}-body`;
          const chipId = `${idBase}-${key}-chip`;
          return (
            <label key={choice.intent} className="welcome-choice" data-intent={key}>
              <input
                id={`welcome-choice-${key}`}
                type="checkbox"
                name="intent"
                value={choice.intent}
                className="welcome-choice__input"
                aria-labelledby={titleId}
                aria-describedby={`${bodyId} ${chipId}`}
                checked={chosen.has(choice.intent)}
                onChange={(event) => toggle(choice.intent, event.currentTarget.checked)}
              />
              <span className="welcome-choice__top">
                <span className="welcome-choice__seal" aria-hidden="true">
                  <PersonMarker kind={choice.marker} className="welcome-choice__marker" />
                </span>
                <span id={titleId} className="welcome-choice__title">
                  {choice.title}
                </span>
                <span className="welcome-choice__check" aria-hidden="true">
                  <PiCheckBold />
                </span>
              </span>
              <span id={bodyId} className="welcome-choice__body">
                {choice.body}
              </span>
              <span id={chipId} className="welcome-choice__foot">
                <StatusChip choice={choice} status={statuses[choice.intent]} />
              </span>
            </label>
          );
        })}
      </fieldset>

      <p className="welcome-info">
        <PiInfoBold aria-hidden="true" className="welcome-info__icon" />
        <span>{WELCOME.info}</span>
      </p>

      <div className="welcome-actions">
        <button
          type="submit"
          name="action"
          value="continue"
          aria-disabled={sending || undefined}
          className={cx(ACTION_BUTTON, BUTTON_VARIANTS.primary, "welcome-actions__continue")}
        >
          {WELCOME.continue}
          <PiArrowRightBold aria-hidden="true" className="size-4" />
        </button>
        <div className="welcome-actions__more">
          {hydrated && (
            <span className="welcome-actions__count" aria-hidden="true">
              {count} selected
            </span>
          )}
          <button
            type="submit"
            name="action"
            value="explore"
            aria-disabled={sending || undefined}
            className={cx(ACTION_BUTTON, "welcome-actions__explore")}
          >
            {WELCOME.explore}
          </button>
          <span className="welcome-actions__later">{WELCOME.later}</span>
        </div>
      </div>
    </form>
  );
}
