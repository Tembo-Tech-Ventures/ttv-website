/** Optional motion and evidence highlighting; no content or route depends on JS. */
export function initHomepageMotion(root: HTMLElement): () => void {
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const story = root.querySelector<HTMLElement>(".home-story");
  const animations = new Set<Animation>();
  const listeners = new AbortController();
  let observer: IntersectionObserver | undefined;
  let disposed = false;
  // Hold only the decorative entrance, for at most 500ms. Content is ordinary
  // server markup; failed fonts, disabled JS and reduced motion remain usable.
  const entrance = reduced.matches ? [] : Array.from(root.querySelectorAll<HTMLElement>(".home-wordmark-line > span, .home-invitation, .home-hero-line")).flatMap((element) => element.getAnimations());
  entrance.forEach((animation) => { animation.pause(); animation.currentTime = 0; });
  let fontTimeout: ReturnType<typeof setTimeout> | undefined;
  const fonts = document.fonts ? Promise.all([
    document.fonts.load('900 1em Mattone'),
    document.fonts.load('400 1em "Maven Pro"'),
    document.fonts.load('600 1em "Maven Pro"'),
  ]).catch(() => undefined) : Promise.resolve();
  void Promise.race([fonts, new Promise<void>((resolve) => { fontTimeout = setTimeout(resolve, 500); })]).then(() => {
    clearTimeout(fontTimeout);
    if (!disposed && !reduced.matches) entrance.forEach((animation) => animation.play());
    return undefined;
  });
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
        const animation = entry.target.animate([
          { opacity: .25, transform: "translateY(24px)" },
          { opacity: 1, transform: "translateY(0)" },
        ], { duration: 850, delay, fill: "backwards", easing: "cubic-bezier(.22, 1, .36, 1)" });
        animations.add(animation);
        animation.onfinish = () => animations.delete(animation);
      }
    }, { threshold: .05 });
    root.querySelectorAll("[data-home-reveal]").forEach((element) => observer?.observe(element));
  };
  configure();
  reduced.addEventListener("change", configure);
  return () => {
    disposed = true;
    clearTimeout(fontTimeout);
    entrance.forEach((animation) => animation.cancel());
    observer?.disconnect();
    animations.forEach((animation) => animation.cancel());
    reduced.removeEventListener("change", configure);
    listeners.abort();
    if (story) delete story.dataset.activeStage;
  };
}
