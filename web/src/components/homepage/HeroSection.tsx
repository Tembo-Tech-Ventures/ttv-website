import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

interface HeroSectionProps {
  isAuthenticated?: boolean;
}

export default function HeroSection({ isAuthenticated = false }: HeroSectionProps) {
  const sectionRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const taglineRef = useRef<HTMLParagraphElement>(null);
  const ctaRef = useRef<HTMLDivElement>(null);
  const railRef = useRef<HTMLDivElement>(null);

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

      if (railRef.current) {
        tl.from(
          railRef.current.children,
          {
            y: 24,
            opacity: 0,
            duration: 0.5,
            stagger: 0.1,
            ease: "power3.out",
          },
          "-=0.2"
        );
      }
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
        className="font-body relative z-10 mb-10 max-w-3xl text-center text-lg text-white/80 md:text-xl lg:text-2xl"
      >
        Career-launching technical training, hands-on mentorship, and a stronger path into
        software, data, and digital delivery for underrepresented talent.
      </p>

      <div ref={ctaRef} className="relative z-10 flex flex-col items-center gap-4 sm:flex-row">
        <a
          href={isAuthenticated ? "/dashboard" : "/auth/login"}
          className="font-body inline-flex min-w-[220px] items-center justify-center rounded-full px-8 py-3 text-lg font-semibold text-white transition-transform hover:scale-105"
          style={{ backgroundColor: "#F28D68" }}
        >
          {isAuthenticated ? "Open Dashboard" : "Sign In With GitHub"}
        </a>
        <a
          href="#features"
          className="font-body inline-flex min-w-[220px] items-center justify-center rounded-full border border-white/20 px-8 py-3 text-lg font-semibold text-white/90 transition-colors hover:border-white/40 hover:text-white"
        >
          Explore Programs
        </a>
      </div>

      <div
        ref={railRef}
        className="relative z-10 mt-12 grid w-full max-w-4xl gap-4 md:grid-cols-3"
      >
        <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 backdrop-blur">
          <p className="text-xs uppercase tracking-[0.2em] text-white/50">Focus</p>
          <p className="mt-2 text-lg font-semibold text-white">Applied technical training</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 backdrop-blur">
          <p className="text-xs uppercase tracking-[0.2em] text-white/50">Model</p>
          <p className="mt-2 text-lg font-semibold text-white">Mentorship with real accountability</p>
        </div>
        <div className="rounded-2xl border border-white/10 bg-white/5 px-5 py-4 backdrop-blur">
          <p className="text-xs uppercase tracking-[0.2em] text-white/50">Outcome</p>
          <p className="mt-2 text-lg font-semibold text-white">A clearer path to delivery-ready talent</p>
        </div>
      </div>
    </section>
  );
}
