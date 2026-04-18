import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { UsersThree, Handshake, Infinity as InfinityIcon } from "@phosphor-icons/react";

gsap.registerPlugin(ScrollTrigger);

/**
 * "What We Do" — bento grid.
 *
 * Rewritten to match the real program: we're less a training bootcamp
 * and more a community of people building together, with mentorship
 * and long-term continuity. Icons are Phosphor (light weight) instead
 * of hand-rolled SVGs.
 */
interface BentoItem {
  number: string;
  label: string;
  title: string;
  body: string;
  Icon: typeof UsersThree;
  wide?: boolean;
}

const BENTO: BentoItem[] = [
  {
    number: "01",
    label: "Community",
    title: "Not a course. A working group.",
    body: "Each cohort is a small group learning side-by-side while building real things. The community is the product — the curriculum is a scaffold toward building on your own.",
    Icon: UsersThree,
    wide: true,
  },
  {
    number: "02",
    label: "Mentorship",
    title: "You don't do this alone.",
    body: "Working engineers walk each cohort through the shape of a real system. Accountability over assignments.",
    Icon: Handshake,
  },
  {
    number: "03",
    label: "Continuity",
    title: "We stay in touch.",
    body: "Alumni stay in the loop after the cohort ends. If someone drifts, we reach out. Some come back as mentors.",
    Icon: InfinityIcon,
  },
];

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
          § 01 What we do
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
          A community,
          <br />
          not a course.
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
                <item.Icon size={item.wide ? 64 : 48} weight="light" aria-hidden />
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
