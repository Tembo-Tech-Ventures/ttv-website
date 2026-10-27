import { all } from "./shared";

/**
 * Always on, whatever the motion preference, because neither is motion:
 *  - infinite loops (scan glints, pulses, the marquee) pause while off screen,
 *    so an idle phone is not repainting what nobody can see;
 *  - community rows answer a press immediately (`.is-pressed`), because touch
 *    has no hover and iOS only applies :active when a touch listener exists.
 */
export function initAmbient(root: HTMLElement): void {
  const loops = all(root, "[data-ha-loop]");
  if (loops.length > 0 && "IntersectionObserver" in window) {
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) entry.target.classList.toggle("ha-offscreen", !entry.isIntersecting);
    });
    for (const loop of loops) observer.observe(loop);
  }

  for (const row of all(root, "[data-ha-press]")) {
    const release = () => row.classList.remove("is-pressed");
    row.addEventListener("pointerdown", () => row.classList.add("is-pressed"), { passive: true });
    for (const type of ["pointerup", "pointercancel", "pointerleave"] as const) {
      row.addEventListener(type, release, { passive: true });
    }
  }
}
