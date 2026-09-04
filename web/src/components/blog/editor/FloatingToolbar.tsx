/**
 * The formatting toolbar that appears over a text selection.
 *
 * There is no permanent toolbar anywhere in this editor on purpose: a strip of
 * buttons pinned above the page is the single thing that makes a writing
 * surface feel like a form. Formatting shows up where the text is, when there
 * is text to format, and is otherwise absent.
 */
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { $isLinkNode, TOGGLE_LINK_COMMAND } from "@lexical/link";
import { $findMatchingParent, mergeRegister } from "@lexical/utils";
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  FORMAT_TEXT_COMMAND,
  SELECTION_CHANGE_COMMAND,
  type LexicalEditor,
} from "lexical";
import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  PiCodeBold,
  PiLinkSimpleBold,
  PiListBulletsBold,
  PiListNumbersBold,
  PiQuotesBold,
  PiTextBBold,
  PiTextHOneBold,
  PiTextHTwoBold,
  PiTextItalicBold,
  PiTextStrikethroughBold,
  PiXBold,
} from "react-icons/pi";
import { $blockTypeOfSelection, setBlockType, type BlockType } from "./blocks";

/** Gap between the selection and the toolbar sitting above it. */
const OFFSET = 12;

/** Minimum gap between the toolbar and either edge of the canvas. */
const EDGE_MARGIN = 8;

interface Placement {
  top: number;
  left: number;
}

interface ToolbarState {
  placement: Placement | null;
  formats: Set<string>;
  block: BlockType;
  link: string | null;
}

const EMPTY_STATE: ToolbarState = {
  placement: null,
  formats: new Set(),
  block: "paragraph",
  link: null,
};

interface FloatingToolbarProps {
  /**
   * The positioned element the toolbar is placed against. It has to be the
   * scrolling canvas rather than the viewport: an absolutely positioned
   * toolbar inside the scroller stays glued to its paragraph while the page
   * moves, where a fixed one would need re-measuring on every scroll frame.
   */
  anchorRef: React.RefObject<HTMLElement | null>;
}

export default function FloatingToolbar({ anchorRef }: FloatingToolbarProps) {
  const [editor] = useLexicalComposerContext();
  const [state, setState] = useState<ToolbarState>(EMPTY_STATE);
  const [linkDraft, setLinkDraft] = useState<string | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const linkInputRef = useRef<HTMLInputElement>(null);

  const sync = useCallback(() => {
    // While the link field is open the selection lives in an input, so the
    // editor reports no range. Re-reading it here would close the toolbar out
    // from under the author mid-URL.
    if (linkDraft !== null) return;

    editor.getEditorState().read(() => {
      const selection = $getSelection();
      const anchor = anchorRef.current;
      const nativeSelection = window.getSelection();

      if (
        !anchor ||
        !$isRangeSelection(selection) ||
        selection.isCollapsed() ||
        selection.getTextContent().trim() === "" ||
        !nativeSelection ||
        nativeSelection.rangeCount === 0
      ) {
        setState((previous) =>
          previous.placement === null ? previous : EMPTY_STATE
        );
        return;
      }

      const rect = nativeSelection.getRangeAt(0).getBoundingClientRect();
      const anchorRect = anchor.getBoundingClientRect();
      const formats = new Set(
        (["bold", "italic", "strikethrough", "code"] as const).filter((format) =>
          selection.hasFormat(format)
        )
      );

      const linkNode = $findMatchingParent(selection.anchor.getNode(), $isLinkNode);

      setState({
        placement: {
          top: rect.top - anchorRect.top + anchor.scrollTop,
          // Centred on the selection here; kept inside the canvas by the layout
          // effect below, which can measure the toolbar that this value is
          // about to position.
          left: rect.left - anchorRect.left + rect.width / 2,
        },
        formats,
        block: $blockTypeOfSelection(selection),
        link: linkNode ? linkNode.getURL() : null,
      });
    });
  }, [anchorRef, editor, linkDraft]);

  useEffect(
    () =>
      mergeRegister(
        editor.registerUpdateListener(() => sync()),
        editor.registerCommand(
          SELECTION_CHANGE_COMMAND,
          () => {
            sync();
            return false;
          },
          COMMAND_PRIORITY_LOW
        )
      ),
    [editor, sync]
  );

  // A drag-selection ends on pointerup, which produces no editor update and no
  // selection command — without this the toolbar never appears for the most
  // common way of selecting text with a mouse.
  useEffect(() => {
    const onPointerUp = () => requestAnimationFrame(sync);
    document.addEventListener("pointerup", onPointerUp);
    return () => document.removeEventListener("pointerup", onPointerUp);
  }, [sync]);

  useEffect(() => {
    if (linkDraft !== null) linkInputRef.current?.select();
  }, [linkDraft]);

  /**
   * Pulls the toolbar back inside the canvas.
   *
   * Done here rather than in `sync` because it needs the toolbar's own width,
   * which is not known until it has rendered — and it changes: the link field
   * is a different size from the buttons, and the row wraps on a narrow screen.
   * A layout effect runs before paint, so there is nothing to see moving.
   */
  useLayoutEffect(() => {
    const element = toolbarRef.current;
    const anchor = anchorRef.current;
    if (!element || !anchor || !state.placement) return;

    const half = element.offsetWidth / 2;
    const min = half + EDGE_MARGIN;
    const max = anchor.clientWidth - half - EDGE_MARGIN;
    // When the toolbar is wider than the canvas there is no position that fits,
    // and clamping to `min` would push it off the right instead of the left.
    // Centring loses the least.
    const left =
      max < min
        ? anchor.clientWidth / 2
        : Math.min(Math.max(state.placement.left, min), max);
    element.style.left = `${left}px`;
  }, [anchorRef, linkDraft, state.placement]);

  const { placement } = state;
  if (!placement) return null;

  const submitLink = (event: React.FormEvent) => {
    event.preventDefault();
    const url = (linkDraft ?? "").trim();
    editor.dispatchCommand(TOGGLE_LINK_COMMAND, url === "" ? null : url);
    setLinkDraft(null);
    editor.focus();
  };

  return (
    <div
      ref={toolbarRef}
      // The toolbar is the author's own selection made actionable, so it must
      // not steal focus: mousedown default is prevented on every control, and
      // the container is hidden from the accessibility tree's reading order by
      // being a toolbar with explicit labels rather than a landmark.
      role="toolbar"
      aria-label="Text formatting"
      // Focusable so the toolbar is a single tab stop rather than eleven, and
      // so the role is legal: an interactive role on an element that can never
      // hold focus is a promise the markup does not keep.
      tabIndex={-1}
      className="absolute z-30 -translate-x-1/2 -translate-y-full"
      style={{ top: placement.top - OFFSET, left: placement.left }}
      onMouseDown={(event) => event.preventDefault()}
    >
      {/* `max-w` and wrapping so a phone gets two rows rather than a toolbar
          running off both sides of the screen. */}
      <div className="flex max-w-[calc(100vw-1rem)] flex-wrap items-center justify-center gap-0.5 rounded-3xl border border-rule bg-dark/95 p-1 shadow-2xl shadow-black/40 backdrop-blur">
        {linkDraft === null ? (
          <>
            <FormatButton
              label="Bold"
              shortcut="⌘B"
              active={state.formats.has("bold")}
              onPress={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "bold")}
            >
              <PiTextBBold />
            </FormatButton>
            <FormatButton
              label="Italic"
              shortcut="⌘I"
              active={state.formats.has("italic")}
              onPress={() =>
                editor.dispatchCommand(FORMAT_TEXT_COMMAND, "italic")
              }
            >
              <PiTextItalicBold />
            </FormatButton>
            <FormatButton
              label="Strikethrough"
              active={state.formats.has("strikethrough")}
              onPress={() =>
                editor.dispatchCommand(FORMAT_TEXT_COMMAND, "strikethrough")
              }
            >
              <PiTextStrikethroughBold />
            </FormatButton>
            <FormatButton
              label="Inline code"
              active={state.formats.has("code")}
              onPress={() => editor.dispatchCommand(FORMAT_TEXT_COMMAND, "code")}
            >
              <PiCodeBold />
            </FormatButton>
            <FormatButton
              label={state.link ? "Edit link" : "Add link"}
              shortcut="⌘K"
              active={state.link !== null}
              onPress={() => setLinkDraft(state.link ?? "https://")}
            >
              <PiLinkSimpleBold />
            </FormatButton>

            <Divider />

            <BlockButton
              label="Heading"
              type="heading"
              current={state.block}
              editor={editor}
            >
              <PiTextHOneBold />
            </BlockButton>
            <BlockButton
              label="Subheading"
              type="subheading"
              current={state.block}
              editor={editor}
            >
              <PiTextHTwoBold />
            </BlockButton>
            <BlockButton
              label="Quote"
              type="quote"
              current={state.block}
              editor={editor}
            >
              <PiQuotesBold />
            </BlockButton>
            <BlockButton
              label="Bulleted list"
              type="bullet"
              current={state.block}
              editor={editor}
            >
              <PiListBulletsBold />
            </BlockButton>
            <BlockButton
              label="Numbered list"
              type="number"
              current={state.block}
              editor={editor}
            >
              <PiListNumbersBold />
            </BlockButton>
          </>
        ) : (
          <form className="flex items-center gap-1 pl-2" onSubmit={submitLink}>
            <PiLinkSimpleBold className="shrink-0 text-ink-muted" aria-hidden />
            <input
              ref={linkInputRef}
              type="url"
              value={linkDraft}
              aria-label="Link URL"
              placeholder="https://example.com"
              className="w-56 bg-transparent px-1 py-1 text-sm text-ink-primary outline-none placeholder:text-ink-muted"
              onChange={(event) => setLinkDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setLinkDraft(null);
                  editor.focus();
                }
              }}
              // The input is the one control here that must take focus.
              onMouseDown={(event) => event.stopPropagation()}
            />
            <button
              type="submit"
              className="rounded-full px-3 py-1 text-sm font-medium text-primary hover:bg-primary/15"
            >
              {linkDraft.trim() === "" ? "Remove" : "Apply"}
            </button>
            <button
              type="button"
              aria-label="Cancel link"
              className="rounded-full p-1.5 text-ink-muted hover:bg-white/10 hover:text-ink-primary"
              onClick={() => {
                setLinkDraft(null);
                editor.focus();
              }}
            >
              <PiXBold />
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function Divider() {
  return <span className="mx-1 h-5 w-px bg-rule" aria-hidden />;
}

interface FormatButtonProps {
  label: string;
  shortcut?: string;
  active: boolean;
  onPress: () => void;
  children: React.ReactNode;
}

function FormatButton({
  label,
  shortcut,
  active,
  onPress,
  children,
}: FormatButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      onClick={onPress}
      className={[
        "flex h-8 w-8 items-center justify-center rounded-full text-base transition-colors",
        active
          ? "bg-primary text-dark"
          : "text-ink-secondary hover:bg-white/10 hover:text-ink-primary",
      ].join(" ")}
    >
      {children}
    </button>
  );
}

interface BlockButtonProps {
  label: string;
  type: BlockType;
  current: BlockType;
  editor: LexicalEditor;
  children: React.ReactNode;
}

function BlockButton({
  label,
  type,
  current,
  editor,
  children,
}: BlockButtonProps) {
  return (
    <FormatButton
      label={label}
      active={current === type}
      onPress={() => setBlockType(editor, type)}
    >
      {children}
    </FormatButton>
  );
}
