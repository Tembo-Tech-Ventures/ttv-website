import { gsap } from "gsap";
import { DESKTOP, MOTION, all } from "./shared";

/**
 * The builder gallery. Everywhere it is a native swipe track whose progress
 * meter and step buttons follow the scroll position. On large screens with
 * motion allowed the stage (track and meter only) is pinned instead, vertical
 * scroll drives the track, and the heading slides away as the cards take over.
 */
export function initBuilders(root: HTMLElement, media: gsap.MatchMedia): void {
  const section = root.querySelector<HTMLElement>("[data-ha-builders]");
  const head = section?.querySelector<HTMLElement>("[data-ha-head]");
  const pin = section?.querySelector<HTMLElement>("[data-ha-pin]");
  const viewport = section?.querySelector<HTMLElement>("[data-ha-viewport]");
  const track = section?.querySelector<HTMLElement>("[data-ha-track]");
  if (!section || !head || !pin || !viewport || !track) return;

  const slides = all(track, ".slide");
  const bar = section.querySelector<HTMLElement>("[data-ha-bar]");
  const indexNode = section.querySelector<HTMLElement>("[data-ha-index]")?.firstChild;
  const steps = all<HTMLButtonElement>(section, "[data-ha-step]");

  // Right edges of each card within the track, measured once per layout
  // rather than on every scrubbed frame.
  let rights: number[] = [];
  const cacheEdges = () => {
    rights = slides.map((slide) => slide.offsetLeft + slide.offsetWidth);
  };

  // The counter reads "how many builders you have seen": cards fully in view.
  const setProgress = (progress: number, scrolled: number, visible: number) => {
    const seen = rights.filter((right) => right <= scrolled + visible + 4).length;
    if (bar) bar.style.transform = `scaleX(${Math.max(Math.min(1, Math.max(0, progress)), 0.06)})`;
    if (indexNode instanceof Text) indexNode.data = String(Math.max(1, seen)).padStart(2, "0");
  };

  // Native track: meter and buttons follow scrollLeft.
  const nativeMax = () => track.scrollWidth - track.clientWidth;
  const onTrackScroll = () => {
    if (section.classList.contains("is-pinned")) return;
    const max = nativeMax();
    setProgress(max > 0 ? track.scrollLeft / max : 0, track.scrollLeft, track.clientWidth);
    const [previous, next] = steps;
    if (previous) previous.disabled = track.scrollLeft <= 2;
    if (next) next.disabled = track.scrollLeft >= max - 2;
  };
  const measure = () => {
    cacheEdges();
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

  // Only the stage is pinned, so it fits 1366x768 and real 1440x900 windows.
  media.add(`${DESKTOP} and (min-height: 600px) and ${MOTION}`, () => {
    const navHeight = () => document.querySelector<HTMLElement>("body header")?.offsetHeight ?? 0;
    section.classList.add("is-pinned");
    cacheEdges();
    const distance = () => track.offsetWidth - viewport.clientWidth;
    if (distance() <= 0 || pin.offsetHeight > window.innerHeight - navHeight() - 16) {
      section.classList.remove("is-pinned");
      measure();
      return undefined;
    }
    section.classList.add("has-overflow");
    track.scrollLeft = 0;

    const timeline = gsap.timeline({
      onUpdate(this: gsap.core.Timeline) {
        const travelled = distance() * this.progress();
        setProgress(this.progress(), travelled, viewport.clientWidth);
      },
      scrollTrigger: {
        trigger: pin,
        // Centre the stage in the space under the nav.
        start: () => `center ${navHeight() + (window.innerHeight - navHeight()) / 2}`,
        end: () => `+=${distance()}`,
        pin: true,
        scrub: 0.6,
        invalidateOnRefresh: true,
        onRefresh: cacheEdges,
      },
    });
    timeline.to(track, { x: () => -distance(), ease: "none", duration: 1 }, 0);
    // The heading drifts left and recedes as the cards take the frame.
    timeline.to(head, { xPercent: -8, opacity: 0.35, ease: "power1.in", duration: 0.3 }, 0);

    // Tabbing to an off-screen card scrolls the page to the point where it is in view.
    const onFocus = (event: FocusEvent) => {
      const slide = (event.target as HTMLElement).closest<HTMLElement>(".slide, .end-slide");
      const trigger = timeline.scrollTrigger;
      if (!slide || !trigger) return;
      viewport.scrollLeft = 0;
      const offset = slide.offsetLeft - (slides[0]?.offsetLeft ?? 0);
      const progress = Math.min(1, Math.max(0, offset / distance()));
      window.scrollTo({ top: trigger.start + progress * (trigger.end - trigger.start), behavior: "instant" });
    };
    track.addEventListener("focusin", onFocus);
    setProgress(0, 0, viewport.clientWidth);

    return () => {
      track.removeEventListener("focusin", onFocus);
      section.classList.remove("is-pinned");
      measure();
    };
  });
}
