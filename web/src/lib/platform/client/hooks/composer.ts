import { useCallback, useEffect, useMemo } from "react";
import type { Id } from "../../contracts";
import type { ChannelDraft } from "../channel-drafts";
import {
  selectBusy, selectDraft, selectMentionPeople, selectOutbox, type Composer, type ComposerState, type MentionCandidates,
  type OutboxItem,
} from "../composer";
import type { ChannelState } from "../channel";
import { useStore } from "../store";

const sameItems = <T>(a: readonly T[], b: readonly T[]) => a.length === b.length && a.every((item, i) => item === b[i]);

/**
 * Read composer state. Keeps the composer alive while mounted: the first hook
 * loads this channel's drafts from sessionStorage (never during SSR), matches
 * polled messages to unconfirmed sends, and retries offline sends when the
 * browser is back online.
 */
export function useComposer<T = ComposerState>(
  composer: Composer,
  selector: (state: ComposerState) => T = (state => state as T),
  isEqual?: (a: T, b: T) => boolean,
): T {
  useEffect(() => composer.retain(), [composer]);
  return useStore(composer, selector, isEqual);
}

/** The draft for the channel (`parentId` null) or one thread, and a setter that keeps it in sessionStorage. */
export function useDraft(composer: Composer, parentId: Id | null): [ChannelDraft, (update: Partial<Pick<ChannelDraft, "body" | "embeds">>) => void] {
  const selector = useMemo(() => selectDraft(parentId), [parentId]);
  const draft = useComposer(composer, selector);
  const setDraft = useCallback((update: Partial<Pick<ChannelDraft, "body" | "embeds">>) => composer.setDraft(parentId, update), [composer, parentId]);
  return [draft, setDraft];
}

/** Sends the server has not confirmed, for the channel (`parentId` null) or one thread, oldest first. */
export function useOutbox(composer: Composer, parentId: Id | null): readonly OutboxItem[] {
  const selector = useMemo(() => selectOutbox(parentId), [parentId]);
  return useComposer(composer, selector, sameItems);
}

/** True while an edit, deletion or reaction on this message is unconfirmed. */
export function useMessageBusy(composer: Composer, messageId: Id): boolean {
  const selector = useMemo(() => selectBusy(messageId), [messageId]);
  return useComposer(composer, selector);
}

/**
 * Who `@` can reach in this channel or one of its threads: people seen in the
 * conversation, most recent first, plus Tembo only while `tembo_channels` is on.
 * Updates as messages arrive.
 */
export function useMentionCandidates(composer: Composer, threadId: Id | null = null): MentionCandidates {
  const { offersTembo: tembo, viewerId } = composer;
  const selector = useCallback((state: ChannelState) => selectMentionPeople(state, threadId, viewerId), [threadId, viewerId]);
  const people = useStore(composer.channel, selector, sameItems);
  return useMemo(() => ({ tembo, people }), [tembo, people]);
}
