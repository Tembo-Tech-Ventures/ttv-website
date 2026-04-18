import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/**
 * "What We Do" — bento grid (PROPOSAL §4).
 *
 * Kills the Apple-emoji three-card row. Training gets a wide primary
 * card; Mentorship and Impact stack beside it. Each card leads with an
 * oversized Climate-Crisis numeral (01/02/03) — the chunky face used at
 * a size where it still reads — with monoline SVG icons under the body
 * copy.
 */
interface BentoItem {
  number: string;
  label: string;
  title: string;
  body: string;
  icon: "mortarboard" | "heads" | "elephant";
  wide?: boolean;
}

const BENTO: BentoItem[] = [
  {
    number: "01",
    label: "Training",
    title: "Intensive, applied, cohort-based.",
    body: "Fundamentals to job-ready in months, not years. Built with industry partners and taught by working engineers.",
    icon: "mortarboard",
    wide: true,
  },
  {
    number: "02",
    label: "Mentorship",
    title: "Paid mentors. Real accountability.",
    body: "One-to-one guidance from engineers who are invested in your growth — and compensated for their time.",
    icon: "heads",
  },
  {
    number: "03",
    label: "Impact",
    title: "A pipeline that actually moves.",
    body: "We measure success in hires, retention, and promotions — not in seats filled. Community first, always.",
    icon: "elephant",
  },
];

function Icon({ name }: { name: BentoItem["icon"] }) {
  const common = {
    xmlns: "http://www.w3.org/2000/svg",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true,
  };
  if (name === "mortarboard") {
    return (
      <svg {...common} viewBox="0 0 48 48" width={48} height={48}>
        <path d="M4 20 L24 10 L44 20 L24 30 Z" />
        <path d="M12 24 V34 Q24 42 36 34 V24" />
        <path d="M44 20 V32" />
      </svg>
    );
  }
  if (name === "heads") {
    return (
      <svg {...common} viewBox="0 0 48 48" width={48} height={48}>
        <circle cx="16" cy="18" r="6" />
        <circle cx="32" cy="18" r="6" />
        <path d="M4 40 Q10 28 16 28 Q22 28 24 36" />
        <path d="M24 36 Q26 28 32 28 Q38 28 44 40" />
      </svg>
    );
  }
  return (
    <svg {...common} viewBox="0 0 120 80" width={72} height={48}>
      <path d="M18 48 Q22 22 52 20 Q82 18 94 28 Q104 36 98 52" />
      <path d="M94 28 Q100 24 102 34 Q104 46 96 46" />
      <path d="M104 40 Q112 44 110 54 Q108 62 100 60" />
      <path d="M26 48 Q22 66 34 68" />
      <path d="M88 52 Q90 66 78 68" />
      <path d="M36 56 L34 72" />
      <path d="M52 58 L52 72" />
      <path d="M72 58 L72 72" />
      <path d="M84 56 L86 72" />
    </svg>
  );
}

export default function FeaturesSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(headingRef.current, {
        y: 40,
        opacity: 0,
        duration: 0.8,
        ease: "power3.out",
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top 75%",
          toggleActions: "play none none reverse",
        },
      });

      gsap.from(gridRef.current!.children, {
        y: 60,
        opacity: 0,
        duration: 0.8,
        stagger: 0.18,
        ease: "power3.out",
        scrollTrigger: {
          trigger: gridRef.current,
          start: "top 78%",
          toggleActions: "play none none reverse",
        },
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      id="what-we-do"
      ref={sectionRef}
      className="relative px-4 py-28 sm:px-8 md:py-36"
      style={{ backgroundColor: "var(--color-bg-raised)" }}
    >
      <div className="mx-auto max-w-7xl">
        <p className="font-body mb-6 text-xs font-semibold uppercase tracking-[0.4em] text-primary">
          § 01 What We Do
        </p>
        <h2
          ref={headingRef}
          className="font-heading max-w-4xl text-ink-primary"
          style={{
            fontSize: "clamp(2.5rem, 6.4vw, 5rem)",
            lineHeight: 0.95,
            letterSpacing: "-0.03em",
          }}
        >
          Training. Mentorship.
          <br />
          Measurable impact.
        </h2>

        <div
          ref={gridRef}
          className="mt-16 grid grid-cols-1 gap-4 md:grid-cols-[1.6fr_1fr] md:grid-rows-2 md:gap-6"
        >
          {BENTO.map((item, i) => (
            <article
              key={item.number}
              className={[
                "group relative overflow-hidden border border-[color:var(--color-rule)] p-8 transition-colors hover:border-primary/60 md:p-10",
                item.wide ? "md:row-span-2" : "",
              ].join(" ")}
              style={{ backgroundColor: "rgba(1, 42, 40, 0.55)" }}
            >
              <div className="flex items-start justify-between gap-6">
                <span
                  className="font-heading text-primary"
                  style={{
                    fontSize: item.wide ? "clamp(4.5rem, 10vw, 9rem)" : "clamp(3rem, 6vw, 5rem)",
                    lineHeight: 0.9,
                    letterSpacing: "-0.04em",
                  }}
                >
                  {item.number}
                </span>
                <span className="mt-3 font-body text-xs font-semibold uppercase tracking-[0.28em] text-ink-muted">
                  0{i + 1} / 03
                </span>
              </div>

              <div className={item.wide ? "mt-8 max-w-xl md:mt-12" : "mt-6"}>
                <p className="font-body text-xs font-semibold uppercase tracking-[0.24em] text-primary">
                  {item.label}
                </p>
                <h3
                  className="mt-3 font-body text-ink-primary"
                  style={{
                    fontSize: item.wide ? "clamp(1.6rem, 2.4vw, 2.25rem)" : "1.35rem",
                    lineHeight: 1.2,
                    letterSpacing: "-0.01em",
                  }}
                >
                  {item.title}
                </h3>
                <p className="mt-4 max-w-xl font-body text-base text-ink-secondary md:text-lg">
                  {item.body}
                </p>
              </div>

              <div className="mt-8 text-primary/70 transition-colors group-hover:text-primary">
                <Icon name={item.icon} />
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
