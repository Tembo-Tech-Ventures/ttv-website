import { useEffect, useRef, useState } from "react";
import { PiBellSimple, PiMagnifyingGlass } from "react-icons/pi";
import { IconButton } from "@/components/platform/ui";
import { FOCUS_RING } from "@/components/platform/ui/Button";
import { cx } from "@/components/platform/ui/cx";
import { isSearchShortcut, requestShellOverlay } from "./overlays";

/**
 * Search, with its shortcut. Wide screens show the word and the keys; narrow
 * ones a magnifier, named the same. The overlay itself says what it covers:
 * "everything" would promise more than it reaches. Ctrl K (⌘ K on a Mac) asks for
 * the same overlay from anywhere on the page.
 */
export function SearchTrigger() {
  const ref = useRef<HTMLButtonElement>(null);
  // The server cannot know the platform. Ctrl until hydration says otherwise.
  const [mac, setMac] = useState(false);

  useEffect(() => {
    setMac(/Mac|iPhone|iPad|iPod/.test(navigator.userAgent));
    const onKey = (event: KeyboardEvent) => {
      if (!isSearchShortcut(event)) return;
      event.preventDefault();
      requestShellOverlay({ overlay: "search", trigger: ref.current, via: "shortcut" });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <button
      ref={ref}
      type="button"
      aria-label="Search"
      aria-haspopup="dialog"
      aria-keyshortcuts="Control+K Meta+K"
      onClick={() => requestShellOverlay({ overlay: "search", trigger: ref.current, via: "click" })}
      className={cx(
        "spaces-search inline-flex h-10 shrink-0 items-center gap-2.5 rounded-xl border border-hairline bg-ink-primary/6 text-ink-secondary",
        "transition-colors duration-150 hover:bg-ink-primary/10 hover:text-ink-primary motion-reduce:transition-none",
        "pointer-coarse:h-11",
        FOCUS_RING,
      )}
    >
      <PiMagnifyingGlass aria-hidden="true" className="size-[1.125rem] shrink-0" />
      <span className="spaces-search__words">
        <span className="spaces-search__label text-sm font-medium">Search</span>
        <kbd
          aria-hidden="true"
          className="rounded-md border border-hairline px-1.5 py-0.5 font-body text-[0.6875rem] font-semibold text-ink-muted"
        >
          {mac ? "⌘ K" : "Ctrl K"}
        </kbd>
      </span>
    </button>
  );
}

/** The bell: everything that needs you, across every space you are in. */
export function AttentionBell({ count }: { count: number }) {
  return (
    <IconButton
      label="Attention"
      icon={<PiBellSimple size={20} />}
      badge={count}
      badgeLabel="waiting"
      aria-haspopup="dialog"
      onClick={(event) => requestShellOverlay({ overlay: "attention", trigger: event.currentTarget, via: "click" })}
    />
  );
}
