import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { PiVideoCamera, PiX } from "react-icons/pi";
import type { MessageEmbed, SessionClipEmbed } from "@/lib/platform/contracts";
import Button, { FOCUS_RING } from "@/components/platform/ui/Button";
import { cx } from "@/components/platform/ui/cx";
import { sameEmbed } from "./actions";
import { clipTime, plural } from "./channel-format";
import { MAX_MOMENT_QUERY, createMomentSearch, type MomentFinder, type MomentSearchState } from "./moment-search";

type ClipFinderProps = {
  id: string;
  open: boolean;
  /** The cohort's newest sessions, from their start, as the page brought them: offered before any words are typed. */
  recent: readonly SessionClipEmbed[];
  /** Null where the page has no server to ask (a read-only harness): only the recent sessions then. */
  find: MomentFinder | null;
  attached: readonly MessageEmbed[];
  /** Whether another piece of work still fits on the message. */
  full: boolean;
  onPick: (clip: SessionClipEmbed) => void;
  onClose: () => void;
};

function heading(state: MomentSearchState, count: number): string {
  switch (state.status) {
    case "idle":
      return count > 0 ? "Recent sessions" : "No session moments to share yet.";
    case "searching":
      return "Searching the sessions…";
    case "found":
      return count > 0 ? `${plural(count, "moment")} ${count === 1 ? "mentions" : "mention"} “${state.query}”` : `No moment mentions “${state.query}”. Try other words.`;
    case "failed":
      return "Couldn't search the sessions.";
  }
}

/**
 * "Share a session clip": the words someone remembers from a session find
 * the moments that mention them, and each moment attaches as a clip that
 * starts there (QA2-02). Before any words, the newest sessions are offered
 * from their start, as the attach menu used to. It sits above the composer,
 * outside its form, so Enter here never sends the message.
 */
export default function ClipFinder({ open, ...props }: ClipFinderProps) {
  return open ? <FinderPanel {...props} /> : null;
}

/**
 * Opening and closing the finder from its button, or the narrow composer's
 * "+" menu: closing returns focus to the button, or when the menu item that
 * opened it has gone, to the message box.
 */
export function useClipFinder(box: RefObject<HTMLTextAreaElement | null>) {
  const [open, setOpen] = useState(false);
  const opener = useRef<HTMLElement | null>(null);
  const close = useCallback(() => {
    setOpen(false);
    const trigger = opener.current;
    requestAnimationFrame(() => (trigger?.isConnected ? trigger : box.current)?.focus());
  }, [box]);
  const toggle = useCallback((trigger: HTMLElement | null) => {
    if (open) {
      close();
      return;
    }
    opener.current = trigger;
    setOpen(true);
  }, [open, close]);
  /** A clip was attached: the composer puts focus back in the box itself. */
  const picked = useCallback(() => setOpen(false), []);
  return { open, toggle, close, picked };
}

function FinderPanel({ id, recent, find, attached, full, onPick, onClose }: Omit<ClipFinderProps, "open">) {
  const titleId = `${id}-title`;
  const panel = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [text, setText] = useState("");
  const [state, setState] = useState<MomentSearchState>({ status: "idle" });
  const [search] = useState(() => (find ? createMomentSearch(find, setState) : null));
  useEffect(() => () => search?.dispose(), [search]);

  // Start where the person decides: the words, or with nothing to search, the first clip.
  useEffect(() => {
    const frame = requestAnimationFrame(() => (input.current ?? document.querySelector<HTMLElement>(`#${CSS.escape(id)} button[data-clip]`))?.focus());
    return () => cancelAnimationFrame(frame);
  }, [id]);

  const clips = state.status === "found" ? state.clips : state.status === "idle" ? recent : [];
  const status = heading(state, clips.length);

  // Escape backs out from anywhere in the finder, as it does from the moderation forms.
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    const onKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || event.isComposing) return;
      event.preventDefault();
      event.stopPropagation();
      close.current();
    };
    element.addEventListener("keydown", onKeyDown);
    return () => element.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <section ref={panel} id={id} aria-labelledby={titleId} className="channel-mentions channel-clips" data-clip-finder>
      <div className="flex items-center justify-between gap-2 px-1.5 pb-1">
        <h3 id={titleId} className="channel-panel__title">
          Share a session clip
        </h3>
        <button type="button" aria-label="Close" onClick={onClose} className={cx("channel-clips__close", FOCUS_RING)}>
          <PiX aria-hidden="true" className="size-4" />
        </button>
      </div>
      {search && (
        <div className="flex flex-col gap-1 px-1.5 pb-1.5">
          <label htmlFor={`${id}-words`} className="text-sm font-semibold text-ink-primary">
            Find a moment
          </label>
          <input
            ref={input}
            id={`${id}-words`}
            type="search"
            value={text}
            maxLength={MAX_MOMENT_QUERY}
            autoComplete="off"
            aria-describedby={`${id}-hint`}
            aria-controls={clips.length > 0 ? `${id}-clips` : undefined}
            onChange={(event) => {
              setText(event.target.value);
              search.search(event.target.value);
            }}
            onKeyDown={(event) => {
              // Searching is already under way as the words are typed.
              if (event.key === "Enter") event.preventDefault();
            }}
            className="channel-input h-11 w-full rounded-xl px-3"
          />
          <p id={`${id}-hint`} className="text-[0.8125rem] text-ink-secondary">
            Words said in the session. The clip starts where they were said.
          </p>
        </div>
      )}
      <p className="channel-clips__status" aria-live="polite" data-clip-status={state.status}>
        {status}
      </p>
      {state.status === "failed" && (
        <Button size="sm" variant="quiet" className="mx-1.5 mb-1 self-start" onClick={() => search?.retry()}>
          Try again
        </Button>
      )}
      {clips.length > 0 && (
        <ul id={`${id}-clips`} aria-label="Session moments" className="channel-clips__list">
          {clips.map((clip) => {
            const already = attached.some((item) => sameEmbed(item, clip));
            return (
              <li key={`${clip.recordingId}-${clip.startSeconds}`}>
                <button
                  type="button"
                  disabled={already || full}
                  onClick={() => onPick(clip)}
                  className={cx("channel-clips__option", FOCUS_RING)}
                  data-clip={`${clip.recordingId}@${clip.startSeconds}`}
                >
                  <PiVideoCamera aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-ink-muted" />
                  <span className="min-w-0">
                    <span className="block font-semibold text-ink-primary">
                      {clip.title} · {clipTime(clip.startSeconds)}
                      {already && <span className="font-normal text-ink-muted"> (attached)</span>}
                    </span>
                    <span className="channel-clips__quote">“{clip.quote}”</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
