import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { all, byLine } from "./shared";

/**
 * Scroll-entry motion for everything below the hero. Every tween starts from
 * a pose set here (never in CSS), so without script or with reduced motion the
 * page simply shows its finished state. Call inside a gsap.matchMedia context.
 */
export function initReveals(root: HTMLElement): void {
  revealHeadings(root);
  revealRises(root);
  revealStrip(root);
  revealRhythm(root);
  revealPaths(root);
  revealBand(root);
}

/** Display headings: each line slides up from behind its own mask. */
function revealHeadings(root: HTMLElement): void {
  for (const heading of all(root, '[data-ha-reveal="words"]')) {
    const words = all(heading, ".ha-wi");
    heading.classList.add("ha-masking");
    gsap.set(words, { y: 0, yPercent: 120 });
    ScrollTrigger.create({
      trigger: heading,
      start: "top 98%",
      once: true,
      onEnter: () => {
        const timeline = gsap.timeline({
          onComplete: () => {
            heading.classList.remove("ha-masking");
            gsap.set(words, { clearProps: "transform" });
          },
        });
        byLine(words).forEach((line, index) => {
          timeline.to(line, { yPercent: 0, duration: 0.7, ease: "expo.out", stagger: 0.025 }, index * 0.08);
        });
      },
    });
  }
}

function revealRises(root: HTMLElement): void {
  for (const element of all(root, '[data-ha-reveal="rise"]')) {
    gsap.from(element, {
      opacity: 0,
      y: 32,
      duration: 0.7,
      delay: 0.1,
      ease: "power3.out",
      clearProps: "opacity,transform",
      scrollTrigger: { trigger: element, start: "top 96%", once: true },
    });
  }
}

/** Completed cohorts draw their rule and fill their numeral, one after another. */
function revealStrip(root: HTMLElement): void {
  const strip = root.querySelector<HTMLElement>("[data-ha-strip]");
  if (!strip) return;
  const lines = all(strip, ".is-done .cohort-line");
  const numerals = all(strip, ".is-done .cohort-num");
  const timeline = gsap.timeline({ scrollTrigger: { trigger: strip, start: "top 82%", once: true } });
  timeline
    .from(lines, { scaleX: 0, duration: 0.9, ease: "power3.inOut", stagger: 0.18 }, 0)
    .fromTo(
      numerals,
      { "--ha-fill": "0%" },
      { "--ha-fill": "100%", duration: 0.9, ease: "power2.inOut", stagger: 0.18 },
      0.25,
    );
}

/** The peach line across the rhythm row is drawn by the scroll itself. */
function revealRhythm(root: HTMLElement): void {
  const rhythm = root.querySelector<HTMLElement>("[data-ha-rhythm]");
  const draw = rhythm?.querySelector<HTMLElement>("[data-ha-draw]");
  if (!rhythm || !draw) return;
  gsap.fromTo(
    draw,
    { scaleX: 0 },
    { scaleX: 1, ease: "none", scrollTrigger: { trigger: rhythm, start: "top 92%", end: "top 38%", scrub: 0.5 } },
  );
  gsap.from(all(rhythm, "[data-ha-beat]"), {
    opacity: 0,
    y: 36,
    duration: 0.8,
    ease: "power3.out",
    stagger: 0.12,
    clearProps: "opacity,transform",
    scrollTrigger: { trigger: rhythm, start: "top 96%", once: true },
  });
}

/** Community rows: rules draw left to right, then each row rises. */
function revealPaths(root: HTMLElement): void {
  const paths = root.querySelector<HTMLElement>("[data-ha-paths]");
  if (!paths) return;
  const timeline = gsap.timeline({ scrollTrigger: { trigger: paths, start: "top 96%", once: true } });
  timeline
    .from(all(paths, "[data-ha-rule]"), { scaleX: 0, duration: 1, ease: "power3.inOut", stagger: 0.12 }, 0)
    .from(
      all(paths, ".path"),
      { opacity: 0, y: 40, duration: 0.8, ease: "power3.out", stagger: 0.12, clearProps: "opacity,transform" },
      0.15,
    );
}

/** The hire band opens from an inset card to the full bleed as it arrives. */
function revealBand(root: HTMLElement): void {
  const band = root.querySelector<HTMLElement>("[data-ha-band]");
  if (!band) return;
  gsap.fromTo(
    band,
    { clipPath: "inset(0% 4% 0% 4% round 2.5rem)" },
    {
      clipPath: "inset(0% 0% 0% 0% round 0rem)",
      ease: "none",
      scrollTrigger: { trigger: band, start: "top 96%", end: "top 30%", scrub: 0.4 },
    },
  );
}
