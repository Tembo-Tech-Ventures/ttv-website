import { gsap } from "gsap";
import { all, byLine, countUp, wait } from "./shared";

/**
 * The hero intro: title lines slide up from behind their masks, then the
 * summary, actions and facts rise in and the numerals count. Done in ~1.2s.
 * Runs only if HomeA's inline script posed the hero (motion allowed) and the
 * fallback has not already released it.
 */
export async function playHeroIntro(root: HTMLElement): Promise<void> {
  const html = document.documentElement;
  const hero = root.querySelector<HTMLElement>("[data-ha-hero]");
  const title = hero?.querySelector<HTMLElement>(".ha-h1");
  if (!hero || !title || !html.classList.contains("ha-intro")) return;

  // Line grouping depends on the display face; give it a moment, never longer.
  await Promise.race([document.fonts.ready, wait(350)]);
  if (!html.classList.contains("ha-intro")) return;

  const words = all(title, ".ha-wi");
  const rises = all(hero, "[data-ha-rise]");
  title.classList.add("ha-masking");
  gsap.set(words, { y: 0, yPercent: 120 });
  gsap.set(rises, { opacity: 0, y: 24 });
  html.classList.remove("ha-intro");

  const timeline = gsap.timeline({
    onComplete: () => {
      title.classList.remove("ha-masking");
      gsap.set(words, { clearProps: "transform" });
    },
  });
  byLine(words).forEach((line, index) => {
    timeline.to(line, { yPercent: 0, duration: 0.8, ease: "expo.out", stagger: 0.03 }, index * 0.09);
  });
  timeline.to(
    rises,
    { opacity: 1, y: 0, duration: 0.65, ease: "power3.out", stagger: 0.1, clearProps: "opacity,transform" },
    0.42,
  );
  all(hero, "[data-ha-count]").forEach((counter, index) => countUp(counter, 0.5 + index * 0.08));
}
