import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export default function HeroSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const taglineRef = useRef<HTMLParagraphElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top 80%",
          end: "bottom 20%",
          toggleActions: "play none none reverse",
        },
      });

      tl.from(headingRef.current, {
        y: 60,
        opacity: 0,
        duration: 1,
        ease: "power3.out",
      })
        .from(
          taglineRef.current,
          {
            y: 40,
            opacity: 0,
            duration: 0.8,
            ease: "power3.out",
          },
          "-=0.5"
        )
        .from(
          ctaRef.current,
          {
            y: 30,
            opacity: 0,
            duration: 0.6,
            ease: "power3.out",
          },
          "-=0.3"
        );
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden px-4 py-20"
      style={{ background: "linear-gradient(180deg, #013D39 0%, #012A28 100%)" }}
    >
      {/* Decorative accent */}
      <div className="pointer-events-none absolute left-1/2 top-1/2 h-[600px] w-[600px] -translate-x-1/2 -translate-y-1/2 rounded-full opacity-10"
        style={{ background: "radial-gradient(circle, #F28D68 0%, transparent 70%)" }}
      />

      <h1
        ref={headingRef}
        className="font-heading relative z-10 mb-6 text-center text-5xl leading-tight md:text-7xl lg:text-8xl"
        style={{ color: "#F28D68" }}
      >
        Tembo Tech
        <br />
        Ventures
      </h1>

      <p
        ref={taglineRef}
        className="font-body relative z-10 mb-10 max-w-2xl text-center text-lg text-white/80 md:text-xl lg:text-2xl"
      >
        Empowering the next generation of tech talent through world-class
        training, mentorship, and community.
      </p>

      <div ref={ctaRef} className="relative z-10">
        <a
          href="#features"
          className="font-body inline-block rounded-full px-8 py-3 text-lg font-semibold text-white transition-transform hover:scale-105"
          style={{ backgroundColor: "#F28D68" }}
        >
          Discover What We Do
        </a>
      </div>
    </section>
  );
}
