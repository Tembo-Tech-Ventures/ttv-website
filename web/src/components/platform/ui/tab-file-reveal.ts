/*
 * A scrolling tab strip opens on the current tab through CSS
 * (`scroll-initial-target`), which not every browser has yet. Where it is
 * missing, this does the same once, after the page renders: it centres the
 * current tab in any strip that has it out of view, and touches nothing else.
 */

const STRIPS = ".space-file > .space-file__row > .space-file__nav";

/** Whether this browser needs the help: true where `scroll-initial-target` is unsupported. */
export function needsTabReveal(css: { supports?: (condition: string) => boolean } | undefined = globalThis.CSS): boolean {
  return !css?.supports?.("scroll-initial-target: nearest");
}

/** Scrolls each tab strip under `root` so its current tab is in view. */
export function revealCurrentTabs(root: ParentNode = document): void {
  for (const strip of root.querySelectorAll<HTMLElement>(STRIPS)) {
    const current = strip.querySelector<HTMLElement>('[aria-current="page"]');
    if (!current) continue;
    const box = strip.getBoundingClientRect();
    const tab = current.getBoundingClientRect();
    if (tab.left >= box.left && tab.right <= box.right) continue;
    strip.scrollLeft += tab.left - box.left - (box.width - tab.width) / 2;
  }
}
