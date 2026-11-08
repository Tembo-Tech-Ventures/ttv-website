import { useEffect, useReducer, useState, type FormEvent } from "react";
import { PiArrowRightBold, PiCheckCircleBold, PiHourglassMediumBold, PiInfoBold } from "react-icons/pi";
import { intentSelectionReducer } from "@/lib/platform/client/onboarding-intents";
import { Button, ChoiceCard, Chip, Notice, PersonMarker } from "@/components/platform/ui";
import { CHOICES, WELCOME, type Choice, type ChoiceIntent } from "./copy";
import type { ChoiceStatus } from "./welcome-flow";

export const WELCOME_TITLE_ID = "welcome-title";
export const CHOICES_ERROR_ID = "welcome-choices-error";

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
 * A plain form: each card is the kit's ChoiceCard, a label around a real
 * checkbox, so it works before and without JavaScript, and the selected look
 * comes from CSS (`:has(:checked)`), not from state. Hydration adds the count in the phone's
 * action bar, the "choose at least one" check before posting, and holding
 * the buttons once the form is on its way. The selection follows S-O.2's
 * `intentSelectionReducer`, the one every onboarding surface shares.
 */
export default function WelcomeChoices({ action, selected, statuses, error }: Props) {
  const [selection, dispatch] = useReducer(intentSelectionReducer, { intents: selected, empty: false, dirty: false });
  // The server's answer to the last post, until a choice is made.
  const [refusal, setRefusal] = useState<string | null>(error);
  const [hydrated, setHydrated] = useState(false);
  const [sending, setSending] = useState(false);

  useEffect(() => setHydrated(true), []);
  // Coming back through the browser's history restores the page as it was left: let it be pressed again.
  useEffect(() => {
    const onShow = (event: PageTransitionEvent) => {
      if (event.persisted) setSending(false);
    };
    window.addEventListener("pageshow", onShow);
    return () => window.removeEventListener("pageshow", onShow);
  }, []);

  function toggle(intent: ChoiceIntent) {
    dispatch({ type: "toggle", intent });
    setRefusal(null);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (sending) {
      event.preventDefault();
      return;
    }
    const submitter = (event.nativeEvent as SubmitEvent).submitter as HTMLButtonElement | null;
    if (submitter?.value !== "explore" && selection.intents.length === 0) {
      event.preventDefault();
      dispatch({ type: "continue" });
      return;
    }
    setSending(true);
  }

  const count = selection.intents.length;
  const problem = selection.empty ? WELCOME.required : refusal;

  return (
    <form method="post" action={action} noValidate onSubmit={onSubmit} className="welcome-form">
      {/*
        The one problem with this choice: found before posting (announced as it appears), or sent back
        by the server, when it takes focus as the page opens (`autofocus`, so without JavaScript too).
      */}
      {problem && (
        <Notice tone="danger" id={CHOICES_ERROR_ID} focusOnLoad={error !== null} className="welcome-error">
          {problem}
        </Notice>
      )}
      <fieldset
        className="welcome-choices"
        aria-labelledby={WELCOME_TITLE_ID}
        aria-describedby={problem ? CHOICES_ERROR_ID : undefined}
      >
        {CHOICES.map((choice) => {
          const key = choice.intent.toLowerCase();
          return (
            <ChoiceCard
              key={choice.intent}
              type="checkbox"
              id={`welcome-choice-${key}`}
              name="intent"
              value={choice.intent}
              label={choice.title}
              hint={choice.body}
              mark={<PersonMarker kind={choice.marker} />}
              detail={<StatusChip choice={choice} status={statuses[choice.intent]} />}
              checked={selection.intents.includes(choice.intent)}
              onChange={() => toggle(choice.intent)}
              className="welcome-choice"
            />
          );
        })}
      </fieldset>

      <p className="welcome-info">
        <PiInfoBold aria-hidden="true" className="welcome-info__icon" />
        <span>{WELCOME.info}</span>
      </p>

      <div className="welcome-actions">
        <Button
          type="submit"
          name="action"
          value="continue"
          variant="primary"
          size="lg"
          loading={sending}
          className="welcome-actions__continue"
        >
          {WELCOME.continue}
          <PiArrowRightBold aria-hidden="true" className="size-4" />
        </Button>
        <div className="welcome-actions__more">
          {hydrated && (
            <span className="welcome-actions__count" aria-hidden="true">
              {count} selected
            </span>
          )}
          <Button
            type="submit"
            name="action"
            value="explore"
            variant="ghost"
            size="lg"
            loading={sending}
            className="welcome-actions__explore"
          >
            {WELCOME.explore}
          </Button>
          <span className="welcome-actions__later">{WELCOME.later}</span>
        </div>
      </div>
    </form>
  );
}
