/**
 * Refines the principles' shared word size once Mattone has loaded: measure
 * the widest word and scale every word (font-size only, never the glyphs) so
 * that one fills 98% of its row. The SSR size, from measured advance widths,
 * is already safe; this only removes the small margin it leaves.
 *
 * The size is stored as a fraction of the row width (`--hd-fit` × 100cqi), so
 * it stays fitted through later resizes without measuring again.
 */
export function fitPrinciples(root: HTMLElement): () => void {
  const list = root.querySelector<HTMLElement>("[data-hd-values]");
  const words = [...(list?.querySelectorAll<HTMLElement>("[data-hd-word]") ?? [])];
  if (!list || words.length === 0) return () => {};
  let disposed = false;

  const fit = () => {
    if (disposed) return;
    // offsetWidth ignores the transforms the stack applies while receding.
    const widest = Math.max(...words.map((word) => word.offsetWidth));
    const fontSize = Number.parseFloat(getComputedStyle(words[0]).fontSize);
    if (!widest || !fontSize) return;
    list.style.setProperty("--hd-fit", ((fontSize * 0.98) / widest).toFixed(5));
  };

  void document.fonts.ready.then(fit);
  document.fonts.addEventListener("loadingdone", fit);
  return () => {
    disposed = true;
    document.fonts.removeEventListener("loadingdone", fit);
  };
}
