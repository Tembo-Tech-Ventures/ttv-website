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

        <div className="grid gap-12 md:grid-cols-[1fr_auto] md:items-start md:gap-20">
          <div className="space-y-10">
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
              <span className="mx-2 align-middle text-ink-muted">A symbol of strength, wisdom, and community.</span>
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
                Talent is everywhere. Opportunity is not.
                <span className="block text-primary">We close that gap on purpose.</span>
              </p>
              <p className="mt-6 max-w-xl font-body text-base text-ink-secondary md:text-lg">
                Our mission is to build a pipeline of{" "}
                <span className="text-ink-primary">delivery-ready</span>{" "}
                software engineers drawn from communities the industry keeps
                saying it can&apos;t find — and to keep supporting them long
                after the first job offer.
              </p>
            </blockquote>
          </div>

          <figure
            data-reveal
            aria-hidden="true"
            className="hidden justify-self-end text-primary md:block"
            style={{ opacity: 0.9 }}
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 120 80"
              width={220}
              height={146}
              fill="none"
              stroke="currentColor"
              strokeWidth={1.4}
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M18 48 Q22 22 52 20 Q82 18 94 28 Q104 36 98 52" />
              <path d="M94 28 Q100 24 102 34 Q104 46 96 46" />
              <path d="M104 40 Q112 44 110 54 Q108 62 100 60" />
              <path d="M26 48 Q22 66 34 68" />
              <path d="M88 52 Q90 66 78 68" />
              <path d="M36 56 L34 72" />
              <path d="M52 58 L52 72" />
              <path d="M72 58 L72 72" />
              <path d="M84 56 L86 72" />
              <circle cx="97" cy="34" r="1.2" fill="currentColor" stroke="none" />
            </svg>
          </figure>
        </div>
      </div>
    </section>
  );
}
