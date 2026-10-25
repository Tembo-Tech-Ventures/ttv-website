import { useEffect, useRef } from "react";

/** Fit the actual font's advance width, changing size only, never glyph proportions. */
export default function ValueWord({ word, outlined = false }: { word: string; outlined?: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const wordRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const container = containerRef.current;
    const text = wordRef.current;
    if (!container || !text) return;
    let disposed = false;
    function fit() {
      if (disposed || !container || !text) return;
      const available = container.clientWidth;
      const measured = text.getBoundingClientRect().width;
      if (!available || !measured) return;
      const current = Number.parseFloat(getComputedStyle(text).fontSize);
      text.style.fontSize = `${current * available * 0.98 / measured}px`;
    }
    let lastWidth = container.clientWidth;
    const observer = new ResizeObserver(() => {
      // Font sizing also changes height. Ignore those notifications to avoid
      // fractional glyph rounding causing a resize/refit feedback loop.
      if (container.clientWidth === lastWidth) return;
      lastWidth = container.clientWidth;
      fit();
    });
    observer.observe(container);
    void document.fonts.ready.then(fit);
    document.fonts.addEventListener("loadingdone", fit);
    fit();
    return () => {
      disposed = true;
      observer.disconnect();
      document.fonts.removeEventListener("loadingdone", fit);
    };
  }, [word]);

  return (
    <div ref={containerRef} className="value-word-container">
      <span ref={wordRef} className={`value-word font-heading tracking-display${outlined ? " value-word-outline" : ""}`}>
        {word}
      </span>
    </div>
  );
}
