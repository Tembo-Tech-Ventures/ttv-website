import { useEffect, useRef, useState, type JSX } from "react";
import { PiBellSimple, PiPaperPlaneTilt, PiPushPin } from "react-icons/pi";
import {
  Button,
  Countdown,
  Dialog,
  IconButton,
  LiveAnnouncer,
  Pill,
  REACTIONS,
  TextReaction,
  groupSentence,
  useAnnouncer,
  type CountdownWarning,
} from "@/components/platform/ui";
import type { ReactionKind } from "@/lib/platform/contracts";
import { GUIDE_PEOPLE } from "./people";

/*
 * The parts of the guide you can press. Each demo renders on the server in its
 * resting state, so the page reads the same before it hydrates, and keeps its
 * state to itself: nothing is sent anywhere.
 */

export type LiveDemo = "button" | "icon-button" | "pill" | "reaction" | "dialog" | "announcer" | "countdown";

function SendDemo() {
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function send() {
    setState("sending");
    timer.current = setTimeout(() => setState("sent"), 1400);
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="primary" icon={<PiPaperPlaneTilt />} loading={state === "sending"} onClick={send}>
        {state === "sending" ? "Sending" : "Send request"}
      </Button>
      <output className="text-sm text-ink-secondary">{state === "sent" ? "Sent. This is a demonstration, so nothing left the page." : ""}</output>
    </div>
  );
}

function ToggleDemo() {
  const [pinned, setPinned] = useState(false);
  const [waiting, setWaiting] = useState(4);

  return (
    <div className="flex flex-wrap items-center gap-3">
      <IconButton label="Pin this message" icon={<PiPushPin className="size-5" />} pressed={pinned} onClick={() => setPinned(!pinned)} />
      <IconButton
        label="Attention"
        icon={<PiBellSimple className="size-5" />}
        badge={waiting}
        badgeLabel="waiting"
        onClick={() => setWaiting(0)}
      />
      <span className="text-sm text-ink-muted">Pin toggles; the bell clears its count.</span>
    </div>
  );
}

const REQUESTS = [
  { who: "Kevin Omondi", what: "A review of a fare-splitting app", state: "open" },
  { who: "Brian Kiprop", what: "Thirty minutes on SQL joins", state: "open" },
  { who: "Achieng Otieno", what: "Feedback on a portfolio", state: "decided" },
] as const;

function FilterDemo() {
  const [filter, setFilter] = useState<"open" | "decided">("open");
  const shown = REQUESTS.filter((request) => request.state === filter);
  const count = (state: "open" | "decided") => REQUESTS.filter((request) => request.state === state).length;

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <fieldset className="m-0 flex min-w-0 flex-wrap gap-2 border-0 p-0">
        <legend className="sr-only">Show requests</legend>
        <Pill pressed={filter === "open"} count={count("open")} onClick={() => setFilter("open")}>
          Needs a decision
        </Pill>
        <Pill pressed={filter === "decided"} count={count("decided")} onClick={() => setFilter("decided")}>
          Decided
        </Pill>
      </fieldset>
      <ul className="m-0 flex list-none flex-col gap-1 p-0 text-sm" aria-live="polite">
        {shown.map((request) => (
          <li key={request.who} className="text-ink-secondary">
            <span className="font-semibold text-ink-primary">{request.who}</span> · {request.what}
          </li>
        ))}
      </ul>
    </div>
  );
}

const START: Record<ReactionKind, { count: number; mine: boolean }> = {
  useful: { count: 6, mine: true },
  learned: { count: 2, mine: false },
  thanks: { count: 1, mine: false },
  agree: { count: 0, mine: false },
  congrats: { count: 0, mine: false },
};

function ReactionDemo() {
  const [reactions, setReactions] = useState(START);
  const kinds = ["useful", "learned", "thanks"] as const satisfies readonly (keyof typeof REACTIONS)[];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {kinds.map((kind) => (
        <TextReaction
          key={kind}
          kind={kind}
          count={reactions[kind].count}
          mine={reactions[kind].mine}
          onChange={(active) =>
            setReactions((now) => ({
              ...now,
              [kind]: { count: now[kind].count + (active === now[kind].mine ? 0 : active ? 1 : -1), mine: active },
            }))
          }
        />
      ))}
    </div>
  );
}

function DialogDemo() {
  const [open, setOpen] = useState(false);
  const [outcome, setOutcome] = useState("");
  const { david } = GUIDE_PEOPLE;

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="danger" onClick={() => setOpen(true)}>
        Withdraw request
      </Button>
      <Dialog
        id="guide-dialog-withdraw"
        title={`Withdraw your request to ${david.name}?`}
        open={open}
        onClose={() => {
          setOpen(false);
          setOutcome("Kept. Nothing changed.");
        }}
        actions={
          <Button
            variant="danger"
            onClick={() => {
              setOpen(false);
              setOutcome("Withdrawn. This is a demonstration, so nothing left the page.");
            }}
          >
            Withdraw request
          </Button>
        }
      >
        {david.name.split(" ")[0]} won&apos;t see it any more. You can ask again later.
      </Dialog>
      <output className="text-sm text-ink-secondary">{outcome}</output>
    </div>
  );
}

/** What the demonstration's announcer said, shown, so a sighted reader sees what a screen reader hears. */
function Heard() {
  const voice = useAnnouncer();
  const [heard, setHeard] = useState<readonly { id: number; line: string }[]>([]);
  useEffect(
    () =>
      voice?.store.subscribe(() => {
        const said = voice.store.getState();
        if (said) setHeard((now) => [...now.slice(-3), { id: said.id, line: `${said.priority === "assertive" ? "At once" : "Politely"}: ${said.message}` }]);
      }),
    [voice],
  );

  return (
    <div className="flex min-w-0 flex-col gap-1">
      <p className="m-0 text-xs font-semibold text-ink-secondary">What a screen reader hears</p>
      {heard.length === 0 ? (
        <p className="m-0 text-sm text-ink-secondary">Nothing yet.</p>
      ) : (
        <ol className="m-0 flex list-none flex-col gap-1 p-0 text-sm text-ink-primary">
          {heard.map(({ id, line }) => (
            <li key={id}>{line}</li>
          ))}
        </ol>
      )}
    </div>
  );
}

function AnnouncerControls() {
  const voice = useAnnouncer();
  const { kevin, faith, brian } = GUIDE_PEOPLE;
  const joined = (names: readonly string[]) => groupSentence(names, "joined");

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button
          onClick={() => {
            for (const person of [kevin, faith, brian]) voice?.gather("joined", person.name, { sentence: joined });
          }}
        >
          Three people join
        </Button>
        <Button onClick={() => voice?.say("Recording started", { priority: "assertive" })}>Start recording</Button>
      </div>
      <Heard />
    </div>
  );
}

function AnnouncerDemo() {
  return (
    <LiveAnnouncer name="guide-announcer">
      <AnnouncerControls />
    </LiveAnnouncer>
  );
}

/** The last minute of a call, so the demonstration's two warnings come within a minute and ten seconds. */
const DEMO_WARNINGS: readonly CountdownWarning[] = [
  { at: 60, priority: "assertive" },
  { at: 10, priority: "assertive" },
];

function CountdownDemo() {
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [ended, setEnded] = useState(false);

  return (
    <LiveAnnouncer name="guide-countdown">
      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => {
              setEnded(false);
              setEndsAt(Date.now() + 70_000);
            }}
          >
            {endsAt === null ? "Start a 70-second countdown" : "Start again"}
          </Button>
          {endsAt !== null && <Countdown key={endsAt} endsAt={endsAt} warnings={DEMO_WARNINGS} subject="The demonstration" onEnd={() => setEnded(true)} />}
        </div>
        {ended && <p className="m-0 text-sm text-ink-secondary">Ended. In a call, the server ends it for everyone at this point.</p>}
        <Heard />
      </div>
    </LiveAnnouncer>
  );
}

const DEMOS: Record<LiveDemo, () => JSX.Element> = {
  button: SendDemo,
  "icon-button": ToggleDemo,
  pill: FilterDemo,
  reaction: ReactionDemo,
  dialog: DialogDemo,
  announcer: AnnouncerDemo,
  countdown: CountdownDemo,
};

export default function LiveSpecimen({ demo }: { demo: LiveDemo }) {
  const Demo = DEMOS[demo];
  return <Demo />;
}
