/**
 * The block menu — what an author reaches for when the line is empty and the
 * selection toolbar has nothing to attach to.
 *
 * Two presentations of one menu. On a wide screen it is a `+` in the left
 * gutter of the empty line, which is where the gesture is discoverable without
 * costing any permanent chrome. On a phone there is no gutter, so the same
 * choices sit in a bar above the keyboard.
 */
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { INSERT_HORIZONTAL_RULE_COMMAND } from "@lexical/react/LexicalHorizontalRuleNode";
import { mergeRegister } from "@lexical/utils";
import {
  $getSelection,
  $isParagraphNode,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  SELECTION_CHANGE_COMMAND,
  type LexicalEditor,
} from "lexical";
import React, { useCallback, useEffect, useState } from "react";
import {
  PiCheckSquareBold,
  PiCodeBold,
  PiListBulletsBold,
  PiListNumbersBold,
  PiMinusBold,
  PiPlusBold,
  PiQuotesBold,
  PiTextHOneBold,
  PiTextHTwoBold,
} from "react-icons/pi";
import { setBlockType } from "./blocks";

/** How far left of the text column the `+` sits. */
const GUTTER_OFFSET = 44;

interface MenuItem {
  label: string;
  icon: React.ReactNode;
  apply: (editor: LexicalEditor) => void;
}

const ITEMS: MenuItem[] = [
  { label: "Heading", icon: <PiTextHOneBold />, apply: (e) => setBlockType(e, "heading") },
  { label: "Subheading", icon: <PiTextHTwoBold />, apply: (e) => setBlockType(e, "subheading") },
  { label: "Quote", icon: <PiQuotesBold />, apply: (e) => setBlockType(e, "quote") },
  { label: "Bulleted list", icon: <PiListBulletsBold />, apply: (e) => setBlockType(e, "bullet") },
  { label: "Numbered list", icon: <PiListNumbersBold />, apply: (e) => setBlockType(e, "number") },
  { label: "Task list", icon: <PiCheckSquareBold />, apply: (e) => setBlockType(e, "check") },
  { label: "Code block", icon: <PiCodeBold />, apply: (e) => setBlockType(e, "code") },
  {
    label: "Divider",
    icon: <PiMinusBold />,
    apply: (e) => e.dispatchCommand(INSERT_HORIZONTAL_RULE_COMMAND, undefined),
  },
];

/**
 * Where the caret is, when it is on a line the menu applies to.
 *
 * `null` whenever the caret is in text, inside a list, or absent: offering to
 * turn a paragraph the author is mid-sentence in into a divider is noise, and
 * the `+` following the caret down every line would be worse.
 */
function useEmptyBlockElement(editor: LexicalEditor): HTMLElement | null {
  const [element, setElement] = useState<HTMLElement | null>(null);

  const sync = useCallback(() => {
    editor.getEditorState().read(() => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
        setElement(null);
        return;
      }
      const block = selection.anchor.getNode().getTopLevelElement();
      if (!$isParagraphNode(block) || block.getTextContentSize() > 0) {
        setElement(null);
        return;
      }
      setElement(editor.getElementByKey(block.getKey()));
    });
  }, [editor]);

  useEffect(
    () =>
      mergeRegister(
        editor.registerUpdateListener(sync),
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

  return element;
}

interface GutterMenuProps {
  /** The scrolling canvas the `+` is positioned inside. */
  anchorRef: React.RefObject<HTMLElement | null>;
}

export function BlockInsertGutter({ anchorRef }: GutterMenuProps) {
  const [editor] = useLexicalComposerContext();
  const block = useEmptyBlockElement(editor);
  const [open, setOpen] = useState(false);

  // Moving to another line abandons the menu; leaving it open would apply the
  // next choice somewhere the author is no longer looking.
  useEffect(() => setOpen(false), [block]);

  if (!block || !anchorRef.current) return null;

  const blockRect = block.getBoundingClientRect();
  const anchorRect = anchorRef.current.getBoundingClientRect();
  const top = blockRect.top - anchorRect.top + anchorRef.current.scrollTop;
  // Measured the same way as `top`, against the canvas. Using `offsetLeft`
  // here instead would be relative to the editor's own positioned ancestor —
  // which is zero — and put the button 44px off the left edge of the window.
  const left = Math.max(8, blockRect.left - anchorRect.left - GUTTER_OFFSET);

  return (
    <div
      className="absolute z-20 hidden lg:block"
      style={{ top, left }}
    >
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Insert block"
          aria-expanded={open}
          // Pressing a control here must not take focus out of the editor: the
          // caret is the position the chosen block applies to, and a blur
          // throws it away. Handled per control rather than on the container so
          // the container stays a plain box with no interactive role to keep.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            setOpen((wasOpen) => !wasOpen);
            editor.focus();
          }}
          className={[
            "flex h-8 w-8 items-center justify-center rounded-full border border-rule text-ink-secondary transition",
            open
              ? "rotate-45 border-primary bg-primary text-dark"
              : "hover:border-primary hover:text-primary",
          ].join(" ")}
        >
          <PiPlusBold />
        </button>

        {open && (
          <div
            role="menu"
            aria-label="Insert block"
            className="flex items-center gap-0.5 rounded-full border border-rule bg-dark/95 p-1 shadow-2xl shadow-black/40 backdrop-blur"
          >
            {ITEMS.map((item) => (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                aria-label={item.label}
                title={item.label}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  item.apply(editor);
                  setOpen(false);
                  editor.focus();
                }}
                className="flex h-8 w-8 items-center justify-center rounded-full text-ink-secondary transition-colors hover:bg-white/10 hover:text-ink-primary"
              >
                {item.icon}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * The same menu as a bar above the keyboard.
 *
 * Rendered unconditionally rather than only when a line is empty: on a phone
 * the bar appearing and vanishing as the author types would shove the text
 * under their thumb every few words.
 */
export function BlockInsertBar() {
  const [editor] = useLexicalComposerContext();

  return (
    <div
      role="toolbar"
      aria-label="Insert block"
      tabIndex={-1}
      className="flex items-center gap-1 overflow-x-auto border-t border-rule bg-dark/80 px-3 py-2 backdrop-blur lg:hidden"
    >
      {ITEMS.map((item) => (
        <button
          key={item.label}
          type="button"
          aria-label={item.label}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            item.apply(editor);
            editor.focus();
          }}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ink-secondary transition-colors hover:bg-white/10 hover:text-ink-primary"
        >
          {item.icon}
        </button>
      ))}
    </div>
  );
}
