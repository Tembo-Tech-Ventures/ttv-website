import { gsap } from "gsap";
import { DESKTOP, MOTION, all, byLine, countUp } from "./shared";

/** Position of an element inside an ancestor, from layout (ignores transforms). */
function offsetWithin(element: HTMLElement, ancestor: HTMLElement): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (let node: HTMLElement | null = element; node && node !== ancestor; node = node.offsetParent as HTMLElement | null) {
    x += node.offsetLeft;
    y += node.offsetTop;
  }
  return { x, y };
}

/**
 * Counts the first fact up, but only if the script arrived while the CSS
 * intro is still playing; a late bundle must never reset a settled number.
 */
export function countHeroFacts(root: HTMLElement): void {
  if (performance.now() > 1200) return;
  for (const counter of all(root, "#cohorts [data-ha-count]")) countUp(counter, 0.45);
}

/**
 * Scroll motion for #cohorts, registered on the page's gsap.matchMedia:
 * the headline shears apart as the hero leaves, and the cohort strip assembles.
 * On large screens the hero's running "04" travels down into its slot in the
 * strip while 01 to 03 fill ahead of it; elsewhere the strip fills on arrival.
 */
export function initCohortMotion(root: HTMLElement, media: gsap.MatchMedia): void {
  const section = root.querySelector<HTMLElement>("[data-ha-hero]");
  const hero = section?.querySelector<HTMLElement>("[data-ha-hero-grid]");
  const title = hero?.querySelector<HTMLElement>(".ha-h1");
  const strip = section?.querySelector<HTMLElement>("[data-ha-strip]");
  if (!section || !hero || !title || !strip) return;

  const navHeight = () => document.querySelector<HTMLElement>("body header")?.offsetHeight ?? 0;

  // Exit: alternate lines drift apart as the hero scrolls away.
  media.add(MOTION, () => {
    const shear = gsap.timeline({
      scrollTrigger: { trigger: hero, start: "top top", end: "bottom top", scrub: 0.4, invalidateOnRefresh: true },
    });
    // Group by the inner word spans (their masks' positions), then move the masks:
    // the CSS intro owns the inner spans' transforms.
    const lines = byLine(all(title, ".ha-wi")).map((line) => line.map((word) => word.parentElement ?? word));
    lines.forEach((line, index) => {
      shear.to(line, { x: () => (index % 2 === 0 ? -1 : 1) * window.innerWidth * 0.06, ease: "none" }, 0);
    });
  });

  const lineRules = all(strip, ".is-done .cohort-line");
  const doneNumerals = all(strip, ".is-done .cohort-num");
  const live = hero.querySelector<HTMLElement>("[data-ha-live]");
  const liveNum = live?.querySelector<HTMLElement>("[data-ha-live-num]");
  const liveTag = live?.querySelector<HTMLElement>("[data-ha-live-tag]");
  const slot = strip.querySelector<HTMLElement>("[data-ha-slot]");

  media.add(`${DESKTOP} and ${MOTION}`, () => {
    if (!live || !liveNum || !liveTag || !slot) return undefined;
    // Where the slot sits relative to the hero numeral, and how much smaller it is.
    const delta = () => {
      const from = offsetWithin(liveNum, section);
      const to = offsetWithin(slot, section);
      return { x: to.x - from.x, y: to.y - from.y, scale: slot.offsetHeight / liveNum.offsetHeight };
    };
    let landed = false;
    let drain = 0;
    const land = (progress: number) => {
      const now = progress >= 0.96;
      if (now === landed) return;
      landed = now;
      window.clearTimeout(drain);
      slot.classList.toggle("is-landed", now);
      if (now) drain = window.setTimeout(() => slot.classList.remove("is-landed"), 420);
    };
    gsap.set(lineRules, { scaleX: 0 });
    // Completed numerals start empty while the strip assembles (see CohortSection's CSS).
    strip.classList.add("is-assembling");
    // The slot keeps a faint outline, so the travelling numeral docks into its own place.
    gsap.set(slot, { opacity: 0.12 });
    // On tall screens the strip is already on the first screen: it assembles once,
    // just after the headline intro, instead of sitting hollow until a scroll.
    const assembleOnScroll = window.scrollY > 0 || strip.getBoundingClientRect().top >= window.innerHeight;
    const assemble = assembleOnScroll ? null : gsap.timeline({ delay: 1.3 });
    const travel = gsap.timeline({
      defaults: { ease: "none" },
      onUpdate(this: gsap.core.Timeline) {
        land(this.progress());
      },
      scrollTrigger: {
        trigger: hero,
        start: () => `top ${navHeight()}`,
        endTrigger: strip,
        end: "top 40%",
        scrub: 0.6,
        invalidateOnRefresh: true,
      },
    });
    // It shrinks early, dims a little only while it passes behind the facts,
    // and lands at full strength with a fill that drains away again.
    travel
      .to(liveTag, { opacity: 0, y: 16, duration: 0.15 }, 0)
      .to(liveNum, { x: () => delta().x, y: () => delta().y, ease: "power1.inOut", duration: 1 }, 0)
      .to(liveNum, { scale: () => delta().scale, ease: "power2.out", duration: 0.45 }, 0)
      .to(liveNum, { opacity: 0.28, duration: 0.08 }, 0.3)
      .to(liveNum, { opacity: 1, duration: 0.07 }, 0.55)
      .to(slot, { opacity: 1, duration: 0.04 }, 0.96)
      .to(liveNum, { opacity: 0, duration: 0.04 }, 0.96);
    // 01 to 03 fill in sequence: with the scroll as the 04 travels, or once on arrival.
    const fills = assemble ?? travel;
    const at = assemble ? [0, 0.25] : [0.4, 0.45];
    const duration = assemble ? 0.9 : 0.3;
    const stagger = assemble ? 0.18 : 0.12;
    fills
      .to(lineRules, { scaleX: 1, stagger, duration, ease: assemble ? "power3.inOut" : "none" }, at[0])
      .fromTo(
        doneNumerals,
        { "--ha-fill": "0%" },
        { "--ha-fill": "100%", stagger, duration, ease: assemble ? "power2.inOut" : "none", immediateRender: false },
        at[1],
      );
    return () => {
      window.clearTimeout(drain);
      slot.classList.remove("is-landed");
      strip.classList.remove("is-assembling");
    };
  });

  media.add(`(max-width: 1023.98px) and ${MOTION}`, () => {
    gsap.set(lineRules, { scaleX: 0 });
    // Completed numerals start empty while the strip assembles (see CohortSection's CSS).
    strip.classList.add("is-assembling");
    gsap
      .timeline({ scrollTrigger: { trigger: strip, start: "top 82%", once: true } })
      .to(lineRules, { scaleX: 1, duration: 0.9, ease: "power3.inOut", stagger: 0.18 }, 0)
      .fromTo(
        doneNumerals,
        { "--ha-fill": "0%" },
        { "--ha-fill": "100%", duration: 0.9, ease: "power2.inOut", stagger: 0.18, immediateRender: false },
        0.25,
      );
    return () => strip.classList.remove("is-assembling");
  });
}
