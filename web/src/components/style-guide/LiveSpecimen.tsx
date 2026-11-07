import { useEffect, useRef, useState, type JSX } from "react";
import { PiBellSimple, PiPaperPlaneTilt, PiPushPin } from "react-icons/pi";
import { Button, IconButton, Pill, REACTIONS, TextReaction } from "@/components/platform/ui";
import type { ReactionKind } from "@/lib/platform/contracts";

/*
 * The parts of the guide you can press. Each demo renders on the server in its
 * resting state, so the page reads the same before it hydrates, and keeps its
 * state to itself: nothing is sent anywhere.
 */

export type LiveDemo = "button" | "icon-button" | "pill" | "reaction";

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

const DEMOS: Record<LiveDemo, () => JSX.Element> = {
  button: SendDemo,
  "icon-button": ToggleDemo,
  pill: FilterDemo,
  reaction: ReactionDemo,
};

export default function LiveSpecimen({ demo }: { demo: LiveDemo }) {
  const Demo = DEMOS[demo];
  return <Demo />;
}
