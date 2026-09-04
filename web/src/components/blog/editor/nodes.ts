/**
 * The node types the post editor can hold.
 *
 * One list, shared by the mounted editor and the round-trip tests, so a
 * transformer can never be registered against a node the editor was not told
 * about — which fails at runtime with "node type not registered" rather than at
 * build time.
 */
import { CodeNode } from "@lexical/code-core";
import { LinkNode } from "@lexical/link";
import { ListItemNode, ListNode } from "@lexical/list";
import { HorizontalRuleNode } from "@lexical/react/LexicalHorizontalRuleNode";
import { HeadingNode, QuoteNode } from "@lexical/rich-text";
import type { Klass, LexicalNode } from "lexical";

export const POST_EDITOR_NODES: Klass<LexicalNode>[] = [
  HeadingNode,
  QuoteNode,
  ListNode,
  ListItemNode,
  CodeNode,
  LinkNode,
  HorizontalRuleNode,
];
