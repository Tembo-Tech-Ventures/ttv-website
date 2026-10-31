import { useEffect, useRef, useState } from "react";
import { BellSimpleIcon, PaperPlaneRightIcon } from "@phosphor-icons/react";
import {
  Button,
  IconButton,
  REACTION_KINDS,
  TextReaction,
  type ReactionKind,
} from "@/components/platform/ui";

/** How long the pretend send takes, so the loading state can be seen and tested. */
export const PRETEND_SEND_MS = 900;

type Reactions = Record<ReactionKind, { count: number; mine: boolean }>;

const START: Reactions = {
  useful: { count: 6, mine: false },
  learned: { count: 4, mine: true },
  thanks: { count: 1, mine: false },
  agree: { count: 0, mine: false },
  congrats: { count: 11, mine: false },
};

/**
 * The primitives hydrated, for `/dev/platform-ui`: the same components as the
 * static catalogue, proving they also work as parts of a React island.
 * Nothing here talks to a server.
 */
export default function PrimitivesPlayground() {
  const [reactions, setReactions] = useState(START);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  function react(kind: ReactionKind, active: boolean) {
    setReactions((current) => {
      const before = current[kind];
      if (before.mine === active) return current;
      return { ...current, [kind]: { mine: active, count: before.count + (active ? 1 : -1) } };
    });
  }

  function send() {
    setSending(true);
    timer.current = setTimeout(() => {
      setSending(false);
      setSent((n) => n + 1);
    }, PRETEND_SEND_MS);
  }

  return (
    <div data-playground="" className="flex flex-col gap-5">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-semibold text-sheet-ink-secondary">Reactions</legend>
        <div className="flex flex-wrap gap-x-1.5 gap-y-3">
          {REACTION_KINDS.map((kind) => (
            <TextReaction
              key={kind}
              kind={kind}
              count={reactions[kind].count}
              mine={reactions[kind].mine}
              onChange={(active) => react(kind, active)}
            />
          ))}
        </div>
      </fieldset>
      <fieldset className="flex flex-wrap items-center gap-3">
        <legend className="mb-2 text-sm font-semibold text-sheet-ink-secondary">Buttons</legend>
        <Button variant="primary" icon={<PaperPlaneRightIcon weight="fill" />} loading={sending} onClick={send}>
          {sending ? "Sending" : "Send"}
        </Button>
        <IconButton
          label="Attention"
          icon={<BellSimpleIcon />}
          count={panelOpen ? 0 : 4}
          countNoun="waiting"
          pressed={panelOpen}
          onClick={() => setPanelOpen((open) => !open)}
        />
        <output aria-live="polite" className="text-sm text-sheet-ink-muted">
          {sent === 0 ? "Nothing sent yet." : `Sent ${sent} ${sent === 1 ? "time" : "times"}.`}
        </output>
      </fieldset>
    </div>
  );
}
