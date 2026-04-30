import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/**
 * Hero — design refresh (PROPOSAL §1).
 *
 * Single-line TEMBO wordmark (clamped display type) with a Swahili kicker
 * above and "TECH VENTURES" as a tight, tracked sub-kicker below. The
 * tagline becomes one editorial sentence with the honest commitment
 * highlighted; the GitHub-specific sign-in is demoted to a ghost link
 * under a cleaner "Explore Programs" pill. The FOCUS/MODEL/OUTCOME chips
 * are replaced with three hard proof stats.
 */
interface HeroSectionProps {
  isAuthenticated?: boolean;
}

const PROOF_STATS = [
  { value: "~25", label: "Students across Africa" },
  { value: "01", label: "Partner school \u00b7 Embu College" },
  { value: "04", label: "Cohort in flight" },
];

export default function HeroSection({ isAuthenticated = false }: HeroSectionProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const kickerRef = useRef<HTMLParagraphElement>(null);
  const wordmarkRef = useRef<HTMLHeadingElement>(null);
  const subKickerRef = useRef<HTMLParagraphElement>(null);
  const sentenceRef = useRef<HTMLParagraphElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const statsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const entry = gsap.timeline({
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top 85%",
          toggleActions: "play none none reverse",
        },
      });

      entry
        .from(kickerRef.current, { y: 20, opacity: 0, duration: 0.6, ease: "power3.out" })
        .from(wordmarkRef.current, { y: 60, opacity: 0, duration: 1, ease: "power3.out" }, "-=0.3")
        .from(subKickerRef.current, { y: 20, opacity: 0, duration: 0.5, ease: "power3.out" }, "-=0.4")
        .from(sentenceRef.current, { y: 30, opacity: 0, duration: 0.7, ease: "power3.out" }, "-=0.2")
        .from(ctaRef.current, { y: 20, opacity: 0, duration: 0.5, ease: "power3.out" }, "-=0.3");

      if (statsRef.current) {
        entry.from(
          statsRef.current.children,
          { y: 24, opacity: 0, duration: 0.5, stagger: 0.1, ease: "power3.out" },
          "-=0.2"
        );
      }

      // Split parallax: wordmark slides horizontally on scroll while the
      // hero itself drifts upward. Keeps it feeling like depth, not decoration.
      gsap.to(wordmarkRef.current, {
        xPercent: -6,
        ease: "none",
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top top",
          end: "bottom top",
          scrub: true,
        },
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative flex min-h-[92vh] flex-col justify-between overflow-hidden px-4 pt-16 pb-12 sm:px-8 md:px-12 md:pt-24"
    >
      {/* Soft orange bloom — PROPOSAL §1. */}
      <div
        aria-hidden
        className="pointer-events-none absolute -left-40 top-1/3 h-[720px] w-[720px] rounded-full opacity-[0.18] blur-3xl"
        style={{ background: "radial-gradient(circle, #F28D68 0%, transparent 70%)" }}
      />

      <div className="relative z-10 mx-auto flex w-full max-w-7xl flex-1 flex-col justify-center">
        <p
          ref={kickerRef}
          className="font-body mb-6 text-xs font-semibold uppercase tracking-[0.4em] text-primary"
        >
          § Swahili for &ldquo;elephant&rdquo;
        </p>

        <h1
          ref={wordmarkRef}
          className="font-heading text-ink-primary"
          style={{
            fontSize: "clamp(5rem, 18vw, 15rem)",
            lineHeight: 0.9,
            letterSpacing: "-0.04em",
            margin: 0,
          }}
        >
          TEMBO
        </h1>

        <p
          ref={subKickerRef}
          className="font-body mt-4 text-sm font-semibold uppercase tracking-[0.45em] text-ink-secondary md:text-base"
        >
          Tech&nbsp;&nbsp;·&nbsp;&nbsp;Ventures
        </p>

        <p
          ref={sentenceRef}
          className="font-body mt-10 max-w-3xl text-xl text-ink-primary md:text-[28px] md:leading-[1.25]"
        >
          A practical tech community for early builders across Africa,
          learning through real software —{" "}
          <span
            className="bg-no-repeat pb-1"
            style={{
              backgroundImage: "linear-gradient(transparent 62%, rgba(255,209,102,0.45) 62%)",
              backgroundSize: "100% 100%",
            }}
          >
            still in touch long after the cohort ends
          </span>
          .
        </p>

        <div ref={ctaRef} className="mt-10 flex flex-wrap items-center gap-4">
          <a
            href="/#what-we-do"
            className="font-body inline-flex items-center rounded-full bg-primary px-8 py-4 text-base font-semibold uppercase tracking-[0.18em] text-dark transition-transform hover:scale-[1.03]"
          >
            Explore Programs
          </a>
          {!isAuthenticated && (
            <a
              href="/auth/login"
              className="font-body text-sm font-medium uppercase tracking-[0.18em] text-ink-secondary transition-colors hover:text-ink-primary"
            >
              Sign in &rarr;
            </a>
          )}
          {isAuthenticated && (
            <a
              href="/dashboard"
              className="font-body text-sm font-medium uppercase tracking-[0.18em] text-ink-secondary transition-colors hover:text-ink-primary"
            >
              Open dashboard &rarr;
            </a>
          )}
        </div>
      </div>

      {/* Proof strip — PROPOSAL §1. */}
      <div
        ref={statsRef}
        className="relative z-10 mx-auto mt-16 grid w-full max-w-7xl grid-cols-1 gap-px overflow-hidden border-t border-[color:var(--color-rule)] sm:grid-cols-3"
      >
        {PROOF_STATS.map((stat) => (
          <div
            key={stat.label}
            className="flex flex-col items-start gap-2 border-[color:var(--color-rule)] px-2 py-6 sm:border-r sm:last:border-r-0 md:px-6"
          >
            <span
              className="font-heading text-5xl text-primary md:text-6xl"
              style={{ letterSpacing: "-0.03em" }}
            >
              {stat.value}
            </span>
            <span className="font-body text-xs font-medium uppercase tracking-[0.22em] text-ink-secondary">
              {stat.label}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}
