import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const values = [
  {
    title: "Empowerment",
    description:
      "Giving individuals the tools, knowledge, and confidence to shape their own futures in tech.",
  },
  {
    title: "Impact",
    description:
      "Measuring success not just in graduates, but in lives transformed and communities strengthened.",
  },
  {
    title: "Equity",
    description:
      "Breaking down barriers to ensure everyone has a fair shot at a career in technology.",
  },
  {
    title: "Community",
    description:
      "Building a supportive network where learners, mentors, and partners lift each other up.",
  },
  {
    title: "Innovation",
    description:
      "Constantly evolving our approach to meet the needs of a rapidly changing tech landscape.",
  },
];

export default function ValuesSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const itemsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      gsap.from(headingRef.current, {
        y: 40,
        opacity: 0,
        duration: 0.8,
        ease: "power3.out",
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top 70%",
          toggleActions: "play none none reverse",
        },
      });

      gsap.from(itemsRef.current!.children, {
        x: -40,
        opacity: 0,
        duration: 0.6,
        stagger: 0.15,
        ease: "power3.out",
        scrollTrigger: {
          trigger: itemsRef.current,
          start: "top 75%",
          toggleActions: "play none none reverse",
        },
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="min-h-screen px-4 py-20"
      style={{ backgroundColor: "#013D39" }}
    >
      <div className="mx-auto max-w-4xl">
        <h2
          ref={headingRef}
          className="font-heading mb-16 text-center text-3xl md:text-5xl"
          style={{ color: "#F28D68" }}
        >
          Our Values
        </h2>

        <div ref={itemsRef} className="space-y-8">
          {values.map((value, i) => (
            <div
              key={value.title}
              className="flex items-start gap-6 rounded-lg border border-white/5 p-6 transition-colors hover:border-[#F28D68]/20"
              style={{ backgroundColor: "rgba(44, 105, 100, 0.15)" }}
            >
              <span
                className="font-heading flex h-12 w-12 shrink-0 items-center justify-center rounded-full text-lg text-white"
                style={{ backgroundColor: "#F28D68" }}
              >
                {i + 1}
              </span>
              <div>
                <h3
                  className="font-heading mb-2 text-xl md:text-2xl"
                  style={{ color: "#F28D68" }}
                >
                  {value.title}
                </h3>
                <p className="font-body text-white/70 leading-relaxed">
                  {value.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
