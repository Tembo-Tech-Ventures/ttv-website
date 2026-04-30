import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/**
 * "Why Tembo" — editorial dictionary treatment (PROPOSAL §3).
 *
 * The old gradient-bordered card hid the strongest writing on the site.
 * This version blows the container away and sets the definition line
 * like a dictionary entry, with the mission statement as a pull quote
 * in the display face. The elephant silhouette sits at the right as a
 * single-stroke line drawing, not a contained illustration.
 */
export default function ValueSection() {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from("[data-reveal]", {
        y: 40,
        opacity: 0,
        duration: 0.9,
        stagger: 0.12,
        ease: "power3.out",
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top 70%",
          toggleActions: "play none none reverse",
        },
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      id="why-tembo"
      ref={sectionRef}
      className="relative px-4 py-28 sm:px-8 md:py-36"
    >
      <div className="mx-auto max-w-6xl">
        <p
          data-reveal
          className="font-body mb-10 text-xs font-semibold uppercase tracking-[0.4em] text-primary"
        >
          § 00 Why Tembo
        </p>

        <div className="max-w-4xl space-y-10">
          <p
            data-reveal
            className="font-body text-base text-ink-secondary md:text-lg"
          >
            <span className="font-heading text-ink-primary" style={{ fontSize: "1.6em", letterSpacing: "-0.02em" }}>
              Tembo
            </span>
            <span className="ml-2 align-middle font-body italic text-ink-muted">(n.)</span>
            <span className="mx-2 align-middle text-ink-muted">—</span>
            <span className="align-middle">elephant. Swahili.</span>
            <span className="mx-2 align-middle text-ink-muted">A symbol of strength, memory, and community.</span>
          </p>

          <blockquote
            data-reveal
            className="relative border-l-2 border-primary pl-6 md:pl-10"
          >
            <p
              className="font-heading text-ink-primary"
              style={{
                fontSize: "clamp(2rem, 5.4vw, 4rem)",
                lineHeight: 1.08,
                letterSpacing: "-0.02em",
              }}
            >
              Great builders are already here.
              <span className="block text-primary">We help grow the ecosystem around them.</span>
            </p>
            <p className="mt-6 max-w-2xl font-body text-base text-ink-secondary md:text-lg">
              We&apos;re a small, community-led program for early builders
              across Africa. Working engineers share the{" "}
              <span className="text-ink-primary">shape of a real system</span>
              {" "}— how it fits together, how to keep learning together —
              and stay in touch long after the cohort ends.
            </p>
          </blockquote>
        </div>
      </div>
    </section>
  );
}
