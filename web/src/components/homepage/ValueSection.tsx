import { useEffect, useRef } from "react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

gsap.registerPlugin(ScrollTrigger);

export default function ValueSection() {
  const sectionRef = useRef<HTMLElement>(null);
  const borderRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const ctx = gsap.context(() => {
      // Animate the gradient border
      gsap.fromTo(
        borderRef.current,
        { backgroundSize: "0% 100%" },
        {
          backgroundSize: "200% 100%",
          duration: 2,
          ease: "power2.out",
          scrollTrigger: {
            trigger: sectionRef.current,
            start: "top 70%",
            toggleActions: "play none none reverse",
          },
        }
      );

      // Fade in text content
      gsap.from(contentRef.current!.children, {
        y: 40,
        opacity: 0,
        duration: 0.8,
        stagger: 0.2,
        ease: "power3.out",
        scrollTrigger: {
          trigger: sectionRef.current,
          start: "top 60%",
          toggleActions: "play none none reverse",
        },
      });
    }, sectionRef);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="flex min-h-screen items-center justify-center px-4 py-20"
      style={{ backgroundColor: "#013D39" }}
    >
      <div
        ref={borderRef}
        className="relative rounded-2xl p-[2px]"
        style={{
          background:
            "linear-gradient(135deg, #F28D68, #2C6964, #F28D68, #2C6964)",
          backgroundSize: "200% 100%",
        }}
      >
        <div
          ref={contentRef}
          className="rounded-2xl px-8 py-16 md:px-16 md:py-20"
          style={{ backgroundColor: "#012A28" }}
        >
          <h2
            className="font-heading mb-8 text-center text-3xl md:text-5xl"
            style={{ color: "#F28D68" }}
          >
            Why Tembo?
          </h2>
          <p className="font-body mx-auto mb-6 max-w-2xl text-center text-lg text-white/80 md:text-xl">
            In Swahili, &ldquo;Tembo&rdquo; means elephant — a symbol of
            strength, wisdom, and community. We carry that spirit into
            everything we build.
          </p>
          <p className="font-body mx-auto max-w-2xl text-center text-lg text-white/60 md:text-xl">
            Our mission is to bridge the gap between potential and opportunity
            by providing accessible, high-quality tech training to underserved
            communities. We believe talent is everywhere — opportunity is not.
          </p>
        </div>
      </div>
    </section>
  );
}
