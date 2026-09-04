/**
 * The Markdown dialect the rich editor speaks.
 *
 * Markdown stays the source of truth in the database, so the editor is a lens
 * over it rather than a replacement for it: every keystroke is converted back
 * to Markdown before it is saved. That only works if the editor's transformer
 * set and the publishing pipeline agree about what a post may contain — a
 * construct the editor can produce but `renderPostHtml` strips would vanish
 * between "looks right while writing" and "published".
 *
 * So the set below is derived from `POST_SANITIZE_SCHEMA`, not from Lexical's
 * defaults. `HIGHLIGHT` (`==text==`) is the reason this is spelled out rather
 * than imported wholesale: Lexical ships it in `TEXT_FORMAT_TRANSFORMERS`, it
 * produces a `<mark>`, and both remark-gfm and the sanitizer drop it.
 */
import {
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  CHECK_LIST,
  CODE,
  HEADING,
  INLINE_CODE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  LINK,
  ORDERED_LIST,
  QUOTE,
  STRIKETHROUGH,
  UNORDERED_LIST,
  type ElementTransformer,
  type Transformer,
} from "@lexical/markdown";
import {
  $createHorizontalRuleNode,
  $isHorizontalRuleNode,
  HorizontalRuleNode,
} from "@lexical/react/LexicalHorizontalRuleNode";

/**
 * Thematic breaks. Lexical has the node but ships no Markdown transformer for
 * it, and `<hr>` is in the sanitizer's allow-list, so a section break would
 * otherwise be the one obvious block an author cannot make.
 *
 * Exports `---` — the form authors type — and imports all three CommonMark
 * spellings, so a post written elsewhere with `***` opens as a real divider.
 */
export const HORIZONTAL_RULE: ElementTransformer = {
  dependencies: [HorizontalRuleNode],
  export: (node) => ($isHorizontalRuleNode(node) ? "---" : null),
  regExp: /^(---|\*\*\*|___)\s?$/,
  replace: (parentNode, _children, _match, isImport) => {
    const rule = $createHorizontalRuleNode();
    // On import the matched paragraph *is* the rule. While typing, the
    // paragraph the author is still sitting in has to survive, or the caret
    // lands nowhere and the next keystroke is lost.
    if (isImport || parentNode.getNextSibling() !== null) {
      parentNode.replace(rule);
    } else {
      parentNode.insertBefore(rule);
    }
    rule.selectNext();
  },
  type: "element",
};

/**
 * Order is load-bearing. Lexical tries transformers in sequence, so the
 * two-character formats must come before the one-character formats they start
 * with, or `**bold**` is read as an empty italic followed by `bold*`.
 */
export const POST_TRANSFORMERS: Transformer[] = [
  // Block level.
  HEADING,
  QUOTE,
  UNORDERED_LIST,
  ORDERED_LIST,
  CHECK_LIST,
  HORIZONTAL_RULE,
  CODE,
  // Inline formats, longest marker first.
  BOLD_ITALIC_STAR,
  BOLD_ITALIC_UNDERSCORE,
  BOLD_STAR,
  BOLD_UNDERSCORE,
  ITALIC_STAR,
  ITALIC_UNDERSCORE,
  STRIKETHROUGH,
  INLINE_CODE,
  // Inline patterns.
  LINK,
];
