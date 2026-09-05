/**
 * Block-level operations, shared by the two places that offer them: the
 * floating toolbar over a selection, and the insert menu on an empty line.
 *
 * The `$` prefix is Lexical's convention for "only valid inside an editor
 * read or update" — nothing enforces it, so it is the only warning there is.
 */
import { $createCodeNode, $isCodeNode } from "@lexical/code-core";
import {
  $isListNode,
  INSERT_CHECK_LIST_COMMAND,
  INSERT_ORDERED_LIST_COMMAND,
  INSERT_UNORDERED_LIST_COMMAND,
  ListNode,
  REMOVE_LIST_COMMAND,
} from "@lexical/list";
import {
  $createHeadingNode,
  $createQuoteNode,
  $isHeadingNode,
  $isQuoteNode,
} from "@lexical/rich-text";
import { $setBlocksType } from "@lexical/selection";
import { $getNearestNodeOfType } from "@lexical/utils";
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  $isRootNode,
  type LexicalEditor,
  type RangeSelection,
} from "lexical";

/**
 * The block kinds the editor offers.
 *
 * `heading` and `subheading` are `#` and `##` in Markdown, and `<h2>`/`<h3>`
 * once published — `renderPostHtml` shifts every heading down one so the post
 * title keeps the page's only `<h1>`. The labels avoid the numbers entirely,
 * because the number an author would reasonably expect is wrong either way.
 */
export type BlockType =
  | "paragraph"
  | "heading"
  | "subheading"
  | "quote"
  | "bullet"
  | "number"
  | "check"
  | "code";

const HEADING_TAG = { heading: "h1", subheading: "h2" } as const;

const LIST_TYPES = new Set<BlockType>(["bullet", "number", "check"]);

/** What kind of block the selection sits in, for the toolbar's pressed state. */
export function $blockTypeOfSelection(selection: RangeSelection): BlockType {
  const anchor = selection.anchor.getNode();

  // Checked before the top-level lookup: the selection is inside a ListItemNode
  // and it is the ListNode above it that knows whether this is a bulleted,
  // numbered or task list.
  const list = $getNearestNodeOfType<ListNode>(anchor, ListNode);
  if (list) {
    const type = list.getListType();
    return type === "number" ? "number" : type === "check" ? "check" : "bullet";
  }

  const block = $isRootNode(anchor) ? anchor : anchor.getTopLevelElement();
  if ($isHeadingNode(block)) {
    return block.getTag() === "h1" ? "heading" : "subheading";
  }
  if ($isQuoteNode(block)) return "quote";
  if ($isCodeNode(block)) return "code";
  if ($isListNode(block)) {
    const type = block.getListType();
    return type === "number" ? "number" : type === "check" ? "check" : "bullet";
  }

  return "paragraph";
}

/**
 * Applies a block kind to the selection, toggling back to a paragraph when the
 * selection is already that kind — pressing Quote twice should undo it, not
 * wrap a quote in a quote.
 */
export function setBlockType(editor: LexicalEditor, target: BlockType) {
  editor.update(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return;

    const current = $blockTypeOfSelection(selection);
    const next = current === target ? "paragraph" : target;

    // A list is a wrapper around its items rather than a format on them, so
    // leaving one means unwrapping it before anything else can be applied.
    // Without this, "quote" pressed inside a list produces a quote nested in a
    // list item, which is not what the button says it does.
    if (LIST_TYPES.has(current) && !LIST_TYPES.has(next)) {
      editor.dispatchCommand(REMOVE_LIST_COMMAND, undefined);
    }

    switch (next) {
      case "paragraph":
        // Coming out of a list, REMOVE_LIST_COMMAND has already left
        // paragraphs behind; running $setBlocksType over them as well would
        // discard the selection it just rebuilt.
        if (!LIST_TYPES.has(current)) {
          $setBlocksType(selection, () => $createParagraphNode());
        }
        return;
      case "heading":
      case "subheading":
        $setBlocksType(selection, () => $createHeadingNode(HEADING_TAG[next]));
        return;
      case "quote":
        $setBlocksType(selection, () => $createQuoteNode());
        return;
      case "code":
        $setBlocksType(selection, () => $createCodeNode());
        return;
      case "bullet":
        editor.dispatchCommand(INSERT_UNORDERED_LIST_COMMAND, undefined);
        return;
      case "number":
        editor.dispatchCommand(INSERT_ORDERED_LIST_COMMAND, undefined);
        return;
      case "check":
        editor.dispatchCommand(INSERT_CHECK_LIST_COMMAND, undefined);
    }
  });
}
