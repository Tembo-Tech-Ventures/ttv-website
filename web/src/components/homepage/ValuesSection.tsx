import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

/**
 * Values — kinetic stacked-word poster (PROPOSAL §5).
 *
 * Drops the numbered-row list in favor of one typographic poster: each
 * value is a massive word, vertically stacked, with a *named commitment*
 * beside it instead of an abstract sentence. Each word rises in on
 * scroll; reduced-motion users get the static stack.
 */
interface Value {
  word: string;
  commitment: string;
}

const VALUES: Value[] = [
  { word: "COMMUNITY", commitment: "Less a program, more a group of people building together." },
  { word: "PHILOSOPHY", commitment: "We teach how to see a system, not a syllabus to memorize." },
  { word: "EQUITY", commitment: "No degree required. English required \u2014 fluency isn't." },
  { word: "CONTINUITY", commitment: "We stay in touch after the cohort. We make it easy to reconnect when life pulls someone away." },
  { word: "HONESTY", commitment: "Two students in fintech internships so far. No job placements yet \u2014 we'll tell you when there are." },
];

export default function ValuesSection() {
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const rows = sectionRef.current?.querySelectorAll("[data-value-row]");
      rows?.forEach((row) => {
        const word = row.querySelector("[data-value-word]");
        const commitment = row.querySelector("[data-value-commitment]");
        gsap.from(word, {
          yPercent: 40,
          opacity: 0,
          duration: 1,
          ease: "power3.out",
          scrollTrigger: { trigger: row, start: "top 80%", toggleActions: "play none none reverse" },
        });
        gsap.from(commitment, {
          x: 24,
          opacity: 0,
          duration: 0.7,
          ease: "power3.out",
          delay: 0.2,
          scrollTrigger: { trigger: row, start: "top 80%", toggleActions: "play none none reverse" },
        });
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      id="values"
      ref={sectionRef}
      className="relative px-4 py-28 sm:px-8 md:py-36"
    >
      <div className="mx-auto max-w-7xl">
        <div className="mb-16 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <p className="font-body text-xs font-semibold uppercase tracking-[0.4em] text-primary">
            § 02 Values as commitments
          </p>
          <p className="max-w-md font-body text-base text-ink-secondary md:text-lg">
            Abstract nouns are easy. These are the five things we&apos;ll
            actually put in writing.
          </p>
        </div>

        <ul className="divide-y divide-[color:var(--color-rule)] border-y border-[color:var(--color-rule)]">
          {VALUES.map((v) => (
            <li
              key={v.word}
              data-value-row
              className="grid grid-cols-1 items-center gap-4 overflow-hidden py-8 md:grid-cols-[1fr_minmax(240px,28%)] md:gap-12 md:py-12"
            >
              <span
                data-value-word
                className="font-heading block text-transparent"
                style={{
                  fontSize: "clamp(3rem, 12vw, 10rem)",
                  lineHeight: 0.9,
                  letterSpacing: "-0.04em",
                  WebkitTextStroke: "1px var(--color-primary)",
                }}
              >
                {v.word}
              </span>
              <p
                data-value-commitment
                className="font-body text-lg text-ink-primary md:text-xl"
              >
                {v.commitment}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
