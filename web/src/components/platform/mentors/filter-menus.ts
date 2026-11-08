/*
 * The directory's filter menus ("More areas", the format) once the page has JavaScript. They are
 * details/summary, so they open without it; with it, each list hangs from the edge that keeps it
 * inside the filter row (B1), and Escape or a press elsewhere closes it, Escape back to its button.
 * The directory renders on the server with no island, so MentorsDirectory.astro's script wires them.
 */

/**
 * Which edge of its button a menu's list hangs from, so it stays inside the filter row (B1): its
 * start edge, unless that would run past the row's end, then its end edge if that fits.
 */
export function menuAlignment(button: { left: number; right: number }, width: number, row: { left: number; right: number }): "start" | "end" {
  if (button.left + width <= row.right) return "start";
  return button.right - width >= row.left ? "end" : "start";
}

/** Wires every filter menu in one filter row. Returns what undoes it. */
export function wireFilterMenus(row: HTMLElement): () => void {
  const undo: (() => void)[] = [];
  for (const details of row.querySelectorAll<HTMLDetailsElement>("details[data-filter-menu]")) {
    const align = () => {
      const list = details.querySelector<HTMLElement>(".mentor-filter-menu__list");
      if (!details.open || !list) return;
      details.dataset.align = menuAlignment(details.getBoundingClientRect(), list.offsetWidth, row.getBoundingClientRect());
    };
    const away = (event: PointerEvent) => {
      if (details.open && !details.contains(event.target as Node)) details.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !details.open) return;
      details.open = false;
      details.querySelector("summary")?.focus();
    };
    document.addEventListener("pointerdown", away);
    details.addEventListener("keydown", escape);
    details.addEventListener("toggle", align);
    window.addEventListener("resize", align);
    undo.push(() => {
      document.removeEventListener("pointerdown", away);
      details.removeEventListener("keydown", escape);
      details.removeEventListener("toggle", align);
      window.removeEventListener("resize", align);
    });
  }
  return () => undo.forEach((step) => step());
}
