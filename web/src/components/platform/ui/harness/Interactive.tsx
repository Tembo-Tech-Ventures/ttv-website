import { useState } from "react";
import { PiPushPin } from "react-icons/pi";
import { Button, IconButton, Pill, REACTIONS, TextReaction, type ReactionKind } from "..";

const START: Record<ReactionKind, { count: number; mine: boolean }> = {
  useful: { count: 6, mine: false },
  learned: { count: 4, mine: true },
  thanks: { count: 2, mine: false },
  agree: { count: 0, mine: false },
  congrats: { count: 11, mine: false },
};

/**
 * The same primitives inside a hydrated React island, to prove they work as
 * controls and not only as server-rendered markup.
 */
export default function Interactive() {
  const [reactions, setReactions] = useState(START);
  const [filter, setFilter] = useState<"open" | "decided">("open");
  const [pinned, setPinned] = useState(false);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(0);

  function toggle(kind: ReactionKind) {
    setReactions((current) => {
      const { count, mine } = current[kind];
      return { ...current, [kind]: { count: count + (mine ? -1 : 1), mine: !mine } };
    });
  }

  function send() {
    setSending(true);
    window.setTimeout(() => {
      setSending(false);
      setSent((n) => n + 1);
    }, 900);
  }

  return (
    <div data-interactive className="space-y-6">
      <fieldset>
        <legend className="mb-3 text-sm font-semibold text-ink-secondary">React to the message</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(REACTIONS) as ReactionKind[]).map((kind) => (
            <TextReaction key={kind} kind={kind} {...reactions[kind]} onToggle={() => toggle(kind)} />
          ))}
        </div>
      </fieldset>
      <fieldset>
        <legend className="mb-3 text-sm font-semibold text-ink-secondary">Show requests</legend>
        <div className="flex flex-wrap gap-1">
          <Pill pressed={filter === "open"} count={3} onClick={() => setFilter("open")}>
            Needs a decision
          </Pill>
          <Pill pressed={filter === "decided"} count={8} onClick={() => setFilter("decided")}>
            Decided
          </Pill>
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3">
        <IconButton label="Pin this message" icon={<PiPushPin size={18} />} pressed={pinned} onClick={() => setPinned((p) => !p)} />
        <Button variant="primary" loading={sending} onClick={send}>
          Send
        </Button>
        <output className="text-sm text-ink-muted">
          {sent === 0 ? "Nothing sent yet." : `Sent ${sent} ${sent === 1 ? "time" : "times"}.`}
        </output>
      </div>
    </div>
  );
}
