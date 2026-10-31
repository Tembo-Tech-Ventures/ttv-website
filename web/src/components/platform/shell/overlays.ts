/**
 * How the shell's triggers reach the overlays they open.
 *
 * The search trigger (and Ctrl K / ⌘ K) and the attention bell live in the
 * shell; the search overlay and attention panel (U-1.3) are separate islands.
 * A trigger asks for its overlay with `requestShellOverlay`, and the overlay
 * listens with `onShellOverlay`. The shell renders a trigger only for overlays
 * the page actually mounts (SpacesLayout's `overlays` prop), so no control ever
 * promises something that is not there.
 *
 * The overlay owns everything after the request: dialog semantics, focus, and
 * returning focus to `trigger` when it closes.
 */
import type { SpaceId } from "@/lib/platform/contracts";
import { SPACES } from "@/components/platform/ui/spaces";

export const SHELL_OVERLAYS = ["search", "attention"] as const;
export type ShellOverlay = (typeof SHELL_OVERLAYS)[number];

export const SHELL_OVERLAY_EVENT = "ttv:shell-overlay";

export interface ShellOverlayRequest {
  overlay: ShellOverlay;
  /** The control that asked, to take focus back when the overlay closes. */
  trigger: HTMLElement | null;
  via: "click" | "shortcut";
}

export function requestShellOverlay(request: ShellOverlayRequest): void {
  window.dispatchEvent(new CustomEvent<ShellOverlayRequest>(SHELL_OVERLAY_EVENT, { detail: request }));
}

/** Subscribes an overlay to its requests. Returns the unsubscribe function. */
export function onShellOverlay(overlay: ShellOverlay, handler: (request: ShellOverlayRequest) => void): () => void {
  const listener = (event: Event) => {
    const { detail } = event as CustomEvent<ShellOverlayRequest>;
    if (detail?.overlay === overlay) handler(detail);
  };
  window.addEventListener(SHELL_OVERLAY_EVENT, listener);
  return () => window.removeEventListener(SHELL_OVERLAY_EVENT, listener);
}

/**
 * Live attention counts, from the attention store's owner (U-1.3) to the bell
 * and tabs. The store lives in the overlay island; the shell is another island,
 * so the owner publishes each authoritative count here and the shell reads the
 * latest. Until anything is published (and always on the server) the shell
 * shows the counts `Me` was rendered with. Browser-only: nothing is published
 * during server rendering, where this module is shared across requests.
 */
export type AttentionCounts = Readonly<Record<SpaceId, number>>;

let liveCounts: AttentionCounts | null = null;
const countListeners = new Set<() => void>();

export function publishAttentionCounts(counts: AttentionCounts): void {
  if (liveCounts && SPACES.every((space) => liveCounts?.[space] === counts[space])) return;
  liveCounts = counts;
  for (const listener of Array.from(countListeners)) listener();
}

export function subscribeAttentionCounts(listener: () => void): () => void {
  countListeners.add(listener);
  return () => {
    countListeners.delete(listener);
  };
}

export function latestAttentionCounts(): AttentionCounts | null {
  return liveCounts;
}

type ShortcutEvent =Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey" | "isComposing">;

/** Ctrl K, or ⌘ K on a Mac: the one shortcut every platform search uses. */
export function isSearchShortcut(event: ShortcutEvent): boolean {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    !event.isComposing &&
    event.key.toLowerCase() === "k"
  );
}
