import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

const features = [
  {
    icon: "🎓",
    title: "Training",
    description:
      "Intensive, hands-on tech training programs designed to take you from fundamentals to job-ready skills in months, not years.",
  },
  {
    icon: "🤝",
    title: "Mentorship",
    description:
      "One-on-one guidance from industry professionals who are invested in your growth and committed to helping you succeed.",
  },
  {
    icon: "🌍",
    title: "Impact",
    description:
      "Building a diverse pipeline of tech talent that drives innovation and creates lasting change in communities worldwide.",
  },
];

export default function FeaturesSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const cardsRef = useRef<HTMLDivElement>(null);

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

      gsap.from(cardsRef.current!.children, {
        y: 60,
        opacity: 0,
        duration: 0.8,
        stagger: 0.2,
        ease: "power3.out",
        scrollTrigger: {
          trigger: cardsRef.current,
          start: "top 75%",
          toggleActions: "play none none reverse",
        },
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      id="features"
      ref={sectionRef}
      className="min-h-screen px-4 py-20"
      style={{
        background: "linear-gradient(180deg, #012A28 0%, #013D39 50%, #012A28 100%)",
      }}
    >
      <div className="mx-auto max-w-6xl">
        <h2
          ref={headingRef}
          className="font-heading mb-16 text-center text-3xl md:text-5xl"
          style={{ color: "#F28D68" }}
        >
          What We Do
        </h2>

        <div
          ref={cardsRef}
          className="grid gap-8 md:grid-cols-3"
        >
          {features.map((feature) => (
            <div
              key={feature.title}
              className="group rounded-xl border border-white/10 p-8 transition-colors hover:border-[#F28D68]/30"
              style={{ backgroundColor: "rgba(1, 61, 57, 0.6)" }}
            >
              <div className="mb-4 text-4xl">{feature.icon}</div>
              <h3
                className="font-heading mb-3 text-xl md:text-2xl"
                style={{ color: "#F28D68" }}
              >
                {feature.title}
              </h3>
              <p className="font-body text-white/70 leading-relaxed">
                {feature.description}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
