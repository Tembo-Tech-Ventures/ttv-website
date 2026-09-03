import React, {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { PiArrowUpBold } from "react-icons/pi";

/** Max height before the textarea starts scrolling internally (~6 lines). */
const MAX_HEIGHT_PX = 168;

export interface ComposerHandle {
  focus: () => void;
}

interface ComposerProps {
  onSend: (message: string) => void;
  disabled: boolean;
}

/**
 * The composer is a normal flex child rather than `position: fixed`. A fixed
 * element is positioned against the layout viewport, which does not shrink when
 * the on-screen keyboard opens, so a fixed composer ends up underneath it.
 */
const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { onSend, disabled },
  ref
) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [enterSends] = useState(() =>
    typeof window !== "undefined" ? !window.matchMedia("(pointer: coarse)").matches : true
  );

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
  }));

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_HEIGHT_PX)}px`;
  }, [value]);

  function submit() {
    const trimmed = value.trim();
    if (!trimmed || disabled) return;
    onSend(trimmed);
    setValue("");
  }

  return (
    <div className="shrink-0 border-t border-rule bg-dark/80 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur sm:px-6">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-2xl border border-rule bg-ink-primary/[0.05] p-2 focus-within:border-primary/50"
      >
        <label className="sr-only" htmlFor="chat-composer">
          Message
        </label>
        <textarea
          id="chat-composer"
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          enterKeyHint={enterSends ? "send" : "enter"}
          onKeyDown={(event) => {
            // `isComposing` keeps an IME's Enter (commit candidate) from sending.
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            if (!enterSends || event.shiftKey) return;
            event.preventDefault();
            submit();
          }}
          placeholder="Ask about your sessions…"
          // text-base on mobile: iOS Safari zooms the viewport when a focused
          // input is smaller than 16px, which breaks the fixed-height layout.
          className="max-h-42 min-h-10 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-base text-ink-primary placeholder:text-ink-muted focus:outline-none sm:text-sm"
        />
        <button
          type="submit"
          disabled={disabled || !value.trim()}
          aria-label="Send message"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-dark transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          <PiArrowUpBold className="h-4 w-4" aria-hidden="true" />
        </button>
      </form>
    </div>
  );
});

export default Composer;
