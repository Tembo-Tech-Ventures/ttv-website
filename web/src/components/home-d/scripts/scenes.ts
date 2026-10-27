/**
 * A tiny scroll-linked scene runner. Each scene reads layout in `read` and
 * writes styles in `write`; all reads happen before all writes in one
 * animation frame, so scrolling never forces layout twice. Scenes read real
 * on-screen rects rather than precomputed offsets because most layers here are
 * CSS `position: sticky`, whose positions only exist at the current scroll.
 */
export interface Scene {
  measure?(): void;
  read(): void;
  write(): void;
  destroy(): void;
}

export function runScenes(scenes: Scene[], observe: Element): () => void {
  let frame = 0;
  const tick = () => {
    frame = 0;
    for (const scene of scenes) scene.read();
    for (const scene of scenes) scene.write();
  };
  const request = () => {
    if (!frame) frame = requestAnimationFrame(tick);
  };
  const remeasure = () => {
    for (const scene of scenes) scene.measure?.();
    request();
  };
  let lastWidth = window.innerWidth;
  let lastHeight = window.innerHeight;
  const onResize = () => {
    // Phones resize the viewport as the URL bar shows and hides; only a real
    // change in size is worth a remeasure.
    if (window.innerWidth === lastWidth && Math.abs(window.innerHeight - lastHeight) < 2) return;
    lastWidth = window.innerWidth;
    lastHeight = window.innerHeight;
    remeasure();
  };
  const observer = new ResizeObserver(() => remeasure());
  observer.observe(observe);
  window.addEventListener("scroll", request, { passive: true });
  window.addEventListener("resize", onResize);
  remeasure();
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    window.removeEventListener("scroll", request);
    window.removeEventListener("resize", onResize);
    for (const scene of scenes) scene.destroy();
  };
}

export const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export function navHeight(): number {
  return document.querySelector<HTMLElement>("body header")?.offsetHeight ?? 72;
}
