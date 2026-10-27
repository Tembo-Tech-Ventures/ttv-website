import { gsap } from "gsap";
import { DESKTOP, MOTION, all } from "./shared";

/**
 * The builder gallery. Everywhere it is a native swipe track whose progress
 * meter and step buttons follow the scroll position. On large screens with
 * motion allowed it is pinned instead, and vertical scroll drives the track.
 */
export function initBuilders(root: HTMLElement, media: gsap.MatchMedia): void {
  const section = root.querySelector<HTMLElement>("[data-ha-builders]");
  const pin = section?.querySelector<HTMLElement>("[data-ha-pin]");
  const viewport = section?.querySelector<HTMLElement>("[data-ha-viewport]");
  const track = section?.querySelector<HTMLElement>("[data-ha-track]");
  if (!section || !pin || !viewport || !track) return;

  const slides = all(track, ".slide");
  const bar = section.querySelector<HTMLElement>("[data-ha-bar]");
  const indexNode = section.querySelector<HTMLElement>("[data-ha-index]")?.firstChild;
  const steps = all<HTMLButtonElement>(section, "[data-ha-step]");

  // The counter reads "how many builders you have seen": the last card fully in view.
  const setProgress = (progress: number) => {
    const clamped = Math.min(1, Math.max(0, progress));
    const right = viewport.getBoundingClientRect().right + 4;
    const seen = slides.filter((slide) => slide.getBoundingClientRect().right <= right).length;
    if (bar) bar.style.transform = `scaleX(${Math.max(clamped, 0.06)})`;
    if (indexNode instanceof Text) indexNode.data = String(Math.max(1, seen)).padStart(2, "0");
  };

  // Native track: meter and buttons follow scrollLeft.
  const nativeMax = () => track.scrollWidth - track.clientWidth;
  const onTrackScroll = () => {
    if (section.classList.contains("is-pinned")) return;
    const max = nativeMax();
    setProgress(max > 0 ? track.scrollLeft / max : 0);
    const [previous, next] = steps;
    if (previous) previous.disabled = track.scrollLeft <= 2;
    if (next) next.disabled = track.scrollLeft >= max - 2;
  };
  const measure = () => {
    if (section.classList.contains("is-pinned")) return;
    section.classList.toggle("has-overflow", nativeMax() > 2);
    onTrackScroll();
  };
  track.addEventListener("scroll", onTrackScroll, { passive: true });
  new ResizeObserver(measure).observe(track);
  measure();

  for (const button of steps) {
    button.addEventListener("click", () => {
      const stride = (slides[1]?.offsetLeft ?? 0) - (slides[0]?.offsetLeft ?? 0) || track.clientWidth;
      const smooth = matchMedia(MOTION).matches;
      track.scrollBy({ left: Number(button.dataset.haStep) * stride, behavior: smooth ? "smooth" : "auto" });
    });
  }

  // Short screens keep the native track: a pinned block taller than the space
  // under the nav would hide the bottom of every card for the whole pin.
  media.add(`${DESKTOP} and (min-height: 700px) and ${MOTION}`, () => {
    const navHeight = () => document.querySelector<HTMLElement>("body header")?.offsetHeight ?? 0;
    section.classList.add("is-pinned");
    const distance = () => track.offsetWidth - viewport.clientWidth;
    if (distance() <= 0 || pin.offsetHeight > window.innerHeight - navHeight() - 16) {
      section.classList.remove("is-pinned");
      measure();
      return undefined;
    }
    section.classList.add("has-overflow");
    track.scrollLeft = 0;

    const tween = gsap.to(track, {
      x: () => -distance(),
      ease: "none",
      // Per scrubbed frame, so the meter follows the cards rather than the scrollbar.
      onUpdate(this: gsap.core.Tween) {
        setProgress(this.progress());
      },
      scrollTrigger: {
        trigger: pin,
        // Centre the pinned block in the space under the nav when it fits; otherwise sit just below it.
        start: () => {
          const free = window.innerHeight - navHeight();
          return pin.offsetHeight < free - 32 ? `center ${navHeight() + free / 2}` : `top ${navHeight() + 16}`;
        },
        end: () => `+=${distance()}`,
        pin: true,
        scrub: 0.6,
        invalidateOnRefresh: true,
      },
    });

    // Tabbing to an off-screen card scrolls the page to the point where it is in view.
    const onFocus = (event: FocusEvent) => {
      const slide = (event.target as HTMLElement).closest<HTMLElement>(".slide");
      const trigger = tween.scrollTrigger;
      if (!slide || !trigger) return;
      viewport.scrollLeft = 0;
      const offset = slide.offsetLeft - (slides[0]?.offsetLeft ?? 0);
      const progress = Math.min(1, Math.max(0, offset / distance()));
      window.scrollTo({ top: trigger.start + progress * (trigger.end - trigger.start), behavior: "instant" });
    };
    track.addEventListener("focusin", onFocus);
    setProgress(0);

    return () => {
      track.removeEventListener("focusin", onFocus);
      section.classList.remove("is-pinned");
      measure();
    };
  });
}
