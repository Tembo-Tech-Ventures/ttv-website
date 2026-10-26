/** Optional motion and evidence highlighting; no content or route depends on JS. */
export function initHomepageMotion(root: HTMLElement): () => void {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const story = root.querySelector<HTMLElement>(".home-story");
  const animations = new Set<Animation>();
  const listeners = new AbortController();
  let observer: IntersectionObserver | undefined;
  let hoveredStage = "";
  let focusedStage = "";
  const highlight = () => {
    if (story) story.dataset.activeStage = focusedStage || hoveredStage;
  };
  root.querySelectorAll<HTMLElement>("[data-home-stage]").forEach((link) => {
    const stage = link.dataset.homeStage ?? "";
    link.addEventListener("pointerenter", () => { hoveredStage = stage; highlight(); }, { signal: listeners.signal });
    link.addEventListener("pointerleave", () => { hoveredStage = ""; highlight(); }, { signal: listeners.signal });
    link.addEventListener("focus", () => { focusedStage = stage; highlight(); }, { signal: listeners.signal });
    link.addEventListener("blur", () => { focusedStage = ""; highlight(); }, { signal: listeners.signal });
  });
  const configure = () => {
    observer?.disconnect();
    animations.forEach((animation) => animation.cancel());
    animations.clear();
    if (reduced.matches || !("IntersectionObserver" in window)) return;
    observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer?.unobserve(entry.target);
        if (!(entry.target instanceof HTMLElement) || !entry.target.animate) continue;
        const stage = entry.target.dataset.evidenceStage;
        const delay = stage === "mentor" ? 130 : stage === "question" ? 260 : 0;
        const animate = (element: HTMLElement | null, keyframes: Keyframe[], duration: number, offset = 0) => {
          if (!element?.animate) return;
          const animation = element.animate(keyframes, { duration, delay: delay + offset, fill: "backwards", easing: "cubic-bezier(.22, 1, .36, 1)" });
          animations.add(animation);
          animation.onfinish = () => animations.delete(animation);
        };
        if (stage) {
          animate(entry.target.querySelector(".home-evidence-content"), [
            { opacity: .15, transform: "translateX(24px)" }, { opacity: 1, transform: "translateX(0)" },
          ], 850);
          animate(entry.target.querySelector(".home-evidence-dot"), [
            { transform: "scale(0)" }, { transform: "scale(1)" },
          ], 500, 100);
          animate(entry.target.previousElementSibling?.querySelector<HTMLElement>(".home-evidence-stem") ?? null, [
            { transform: "scaleY(0)" }, { transform: "scaleY(1)" },
          ], 650);
        } else {
          animate(entry.target, [
            { opacity: .25, transform: "translateY(24px)" }, { opacity: 1, transform: "translateY(0)" },
          ], 850);
        }
      }
    }, { threshold: .05 });
    root.querySelectorAll("[data-home-reveal]").forEach((element) => {
      // A deferred script may attach after first paint. Never dim content the
      // visitor can already see; only stage entrances for off-screen content.
      const bounds = element.getBoundingClientRect();
      if (bounds.top < window.innerHeight && bounds.bottom > 0) return;
      observer?.observe(element);
    });
  };
  configure();
  reduced.addEventListener("change", configure);
  return () => {
    observer?.disconnect();
    animations.forEach((animation) => animation.cancel());
    reduced.removeEventListener("change", configure);
    listeners.abort();
    if (story) delete story.dataset.activeStage;
  };
}
