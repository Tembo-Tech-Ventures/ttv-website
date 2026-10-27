import { gsap } from "gsap";
import { all } from "./shared";

/**
 * Fine-pointer flourishes: magnetic primary buttons and the "View" disc over
 * the builder cards. Returns a cleanup for gsap.matchMedia.
 */
export function initPointer(root: HTMLElement): () => void {
  const cleanups: Array<() => void> = [];
  const listen = <K extends keyof HTMLElementEventMap>(
    target: HTMLElement,
    type: K,
    handler: (event: HTMLElementEventMap[K]) => void,
  ) => {
    target.addEventListener(type, handler);
    cleanups.push(() => target.removeEventListener(type, handler));
  };

  for (const button of all(root, "[data-ha-magnetic]")) {
    const xTo = gsap.quickTo(button, "x", { duration: 0.5, ease: "power3.out" });
    const yTo = gsap.quickTo(button, "y", { duration: 0.5, ease: "power3.out" });
    listen(button, "pointermove", (event) => {
      const box = button.getBoundingClientRect();
      const left = box.left - Number(gsap.getProperty(button, "x"));
      const top = box.top - Number(gsap.getProperty(button, "y"));
      // A gentle pull, capped so the button never reaches its neighbours.
      xTo(gsap.utils.clamp(-12, 12, (event.clientX - (left + box.width / 2)) * 0.18));
      yTo(gsap.utils.clamp(-8, 8, (event.clientY - (top + box.height / 2)) * 0.35));
    });
    listen(button, "pointerleave", () => {
      gsap.to(button, { x: 0, y: 0, duration: 0.9, ease: "elastic.out(1, 0.45)" });
    });
    cleanups.push(() => gsap.set(button, { clearProps: "transform" }));
  }

  const section = root.querySelector<HTMLElement>("[data-ha-builders]");
  const cursor = section?.querySelector<HTMLElement>("[data-ha-cursor]");
  const track = section?.querySelector<HTMLElement>("[data-ha-track]");
  if (section && cursor && track) {
    section.classList.add("has-cursor");
    const xTo = gsap.quickTo(cursor, "x", { duration: 0.35, ease: "power3.out" });
    const yTo = gsap.quickTo(cursor, "y", { duration: 0.35, ease: "power3.out" });
    let shown = false;
    const show = (visible: boolean, event?: PointerEvent) => {
      if (visible === shown) return;
      shown = visible;
      if (visible && event) gsap.set(cursor, { x: event.clientX, y: event.clientY });
      gsap.to(cursor, { autoAlpha: visible ? 1 : 0, scale: visible ? 1 : 0, duration: 0.35, ease: "power3.out" });
    };
    listen(track, "pointermove", (event) => {
      const overCard = Boolean((event.target as HTMLElement).closest("[data-ha-card]"));
      show(overCard, event);
      xTo(event.clientX);
      yTo(event.clientY);
    });
    listen(track, "pointerleave", () => show(false));
    cleanups.push(() => {
      section.classList.remove("has-cursor");
      gsap.set(cursor, { clearProps: "all" });
    });
  }

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
