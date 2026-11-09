import React, {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { PiArrowUpBold } from "react-icons/pi";
import { takeAskTemboDraft } from "@/components/platform/search/ask-handoff";
import { CONTROL, IconButton, cx } from "@/components/platform/ui";

/** Max height before the textarea starts scrolling internally (~6 lines). */
const MAX_HEIGHT_PX = 168;

export interface ComposerHandle {
  focus: () => void;
  /** Puts words back in the box, unsent, ready to change: a question that failed, say. */
  fill: (text: string) => void;
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
    fill: (text: string) => {
      setValue(text);
      textareaRef.current?.focus();
    },
  }));

  // A question handed over from search arrives in the box, unsent: the person decides.
  useEffect(() => {
    const draft = takeAskTemboDraft();
    if (!draft) return;
    setValue(draft);
    textareaRef.current?.focus();
  }, []);

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
    <div className="shrink-0 border-t border-hairline px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:px-6">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        // The box is the field, as in a channel's composer: the control's frame, carrying the focus ring while you type.
        className={cx(
          CONTROL,
          "mx-auto flex max-w-3xl items-end gap-2 py-2 pr-2 pl-1.5 focus-within:border-peach-ink focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-peach-ink",
        )}
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
          // The ring is the box's (focus-within above), so the textarea draws none of its own.
          // min-h-11: a 44px target at any width, even one line tall on a 320px phone.
          className="max-h-42 min-h-11 min-w-0 flex-1 resize-none bg-transparent px-2 py-2 text-base text-ink-primary placeholder:text-ink-muted focus-visible:outline-none sm:text-sm"
        />
        {/* The page's one primary action. */}
        <IconButton
          type="submit"
          variant="primary"
          label="Send message"
          icon={<PiArrowUpBold className="size-4" />}
          disabled={disabled || !value.trim()}
        />
      </form>
    </div>
  );
});

export default Composer;
