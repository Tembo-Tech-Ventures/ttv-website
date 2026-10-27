import { gsap } from "gsap";

/**
 * ARIA tabs (automatic activation, roving tabindex, arrows/Home/End) for the
 * three ways into the community. The indicator pill slides by CSS (it follows
 * `--sel`); with motion allowed the panel's picture assembles piece by piece.
 */
export function initCommunityTabs(root: HTMLElement, motionAllowed: () => boolean): () => void {
  const container = root.querySelector<HTMLElement>("[data-hp-tabs]");
  if (!container) return () => {};
  const tabs = [...container.querySelectorAll<HTMLButtonElement>("[data-hp-tab]")];
  const panels = [...container.querySelectorAll<HTMLElement>("[data-hp-panel]")];
  const tablist = container.querySelector<HTMLElement>("[data-hp-tablist]");
  const panelsBox = panels[0]?.parentElement ?? null;

  // Reserve the tallest panel's height (all panels share one grid cell), read
  // in one synchronous pass with the hidden ones laid out invisibly.
  const reserve = () => {
    if (!panelsBox) return;
    panelsBox.style.minHeight = "";
    const hidden = panels.filter((panel) => panel.hidden);
    for (const panel of hidden) {
      panel.hidden = false;
      panel.style.visibility = "hidden";
    }
    const tallest = panelsBox.offsetHeight;
    for (const panel of hidden) {
      panel.hidden = true;
      panel.style.visibility = "";
    }
    panelsBox.style.minHeight = `${tallest}px`;
  };
  let lastWidth = 0;
  const sizer = new ResizeObserver(() => {
    if (!panelsBox || panelsBox.offsetWidth === lastWidth) return;
    lastWidth = panelsBox.offsetWidth;
    reserve();
  });
  if (panelsBox) sizer.observe(panelsBox);
  void document.fonts.ready.then(reserve);
  let current = Math.max(0, tabs.findIndex((tab) => tab.getAttribute("aria-selected") === "true"));
  let assembled = false;

  function assemble(panel: HTMLElement, withCopy: boolean) {
    if (!motionAllowed()) return;
    const pieces = panel.querySelectorAll<HTMLElement>("[data-hp-piece]");
    const copy = panel.querySelector<HTMLElement>("[data-hp-panel-copy]")?.children;
    gsap.killTweensOf(pieces);
    gsap.fromTo(
      pieces,
      {
        opacity: 0,
        y: (index) => 56 + index * 18,
        x: (index) => (index % 2 ? 36 : -36),
        rotation: (index) => (index % 2 ? 9 : -7),
        scale: 0.92,
      },
      { opacity: 1, y: 0, x: 0, rotation: 0, scale: 1, duration: 0.8, stagger: 0.09, ease: "back.out(1.5)", clearProps: "transform,opacity" },
    );
    if (copy && withCopy) {
      gsap.fromTo(copy, { opacity: 0, y: 14 }, { opacity: 1, y: 0, duration: 0.45, stagger: 0.05, ease: "power2.out", clearProps: "transform,opacity" });
    }
  }

  function select(index: number, focus: boolean) {
    if (index === current) {
      if (focus) tabs[index].focus();
      return;
    }
    const previous = current;
    current = index;
    tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
    });
    panels.forEach((panel, i) => {
      panel.hidden = i !== index;
    });
    tablist?.style.setProperty("--sel", String(index));
    if (focus) tabs[index].focus();
    if (previous !== index) assemble(panels[index], true);
  }

  const onClick = (event: Event) => {
    const index = tabs.indexOf(event.currentTarget as HTMLButtonElement);
    if (index >= 0) select(index, false);
  };
  const onKey = (event: KeyboardEvent) => {
    const keys: Record<string, number> = {
      ArrowRight: (current + 1) % tabs.length,
      ArrowLeft: (current - 1 + tabs.length) % tabs.length,
      Home: 0,
      End: tabs.length - 1,
    };
    if (!(event.key in keys)) return;
    event.preventDefault();
    select(keys[event.key], true);
  };
  tabs.forEach((tab) => {
    tab.addEventListener("click", onClick);
    tab.addEventListener("keydown", onKey);
  });

  // The first panel assembles the first time the section comes into view. Its
  // pieces start hidden only here, below the fold, so nothing visible blinks.
  const firstPieces = panels[current]?.querySelectorAll<HTMLElement>("[data-hp-piece]");
  if (firstPieces && motionAllowed()) gsap.set(firstPieces, { opacity: 0 });
  const observer = new IntersectionObserver(
    (entries) => {
      if (assembled || !entries.some((entry) => entry.isIntersecting)) return;
      assembled = true;
      assemble(panels[current], false);
      observer.disconnect();
    },
    { threshold: 0.35 },
  );
  const firstComposition = panels[current]?.querySelector("[data-hp-comp]");
  if (firstComposition) observer.observe(firstComposition);

  return () => {
    sizer.disconnect();
    if (panelsBox) panelsBox.style.minHeight = "";
    observer.disconnect();
    if (firstPieces) gsap.set(firstPieces, { clearProps: "opacity" });
    tabs.forEach((tab) => {
      tab.removeEventListener("click", onClick);
      tab.removeEventListener("keydown", onKey);
    });
  };
}
