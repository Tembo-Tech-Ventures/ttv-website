import { useId, useState, type KeyboardEvent } from "react";
import { VALUES } from "./values";
import ValueWord from "./ValueWord";
// oxlint-disable-next-line import/no-unassigned-import -- Carousel presentation and reduced-motion treatment.
import "./values.css";

export default function FeaturesSection() {
  const [active, setActive] = useState(0);
  const id = useId();
  const value = VALUES[active];
  const select = (index: number) => setActive((index + VALUES.length) % VALUES.length);
  function navigate(event: KeyboardEvent<HTMLButtonElement>) {
    const next = { ArrowRight: active + 1, ArrowLeft: active - 1, Home: 0, End: VALUES.length - 1 }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    select(next);
  }

  return (
    <section id="what-we-do" className="relative px-4 py-28 sm:px-8 md:py-36" style={{ backgroundColor: "var(--color-bg-raised)" }}>
      <div className="mx-auto max-w-7xl">
        <p className="font-body mb-6 text-xs font-semibold uppercase tracking-[0.4em] text-primary">§ 01 What we do</p>
        <h2 id={`${id}-heading`} className="font-heading tracking-heading max-w-4xl text-ink-primary" style={{ fontSize: "clamp(1.5rem, 6.4vw, 5rem)", lineHeight: 0.95 }}>
          A community,<br />not a course.
        </h2>
        <section className="values-carousel" aria-roledescription="carousel" aria-label="Our values">
          <div id={`${id}-slide`} className="values-stage" aria-live="polite" aria-atomic="true">
            <fieldset className="values-slide" aria-roledescription="slide" aria-label={`${active + 1} of ${VALUES.length}`}>
              <ValueWord word={value.word} />
              <div className="values-bubble" key={value.word}>
                <span className="values-bubble-label">Our commitment</span>
                <p>{value.commitment}</p>
              </div>
            </fieldset>
          </div>
          <div className="values-controls">
            <button type="button" onKeyDown={navigate} onClick={() => select(active - 1)} aria-controls={`${id}-slide`} aria-label="Previous value">← <span>Previous</span></button>
            <span className="values-position" aria-hidden="true">{String(active + 1).padStart(2, "0")} / 05</span>
            <button type="button" onKeyDown={navigate} onClick={() => select(active + 1)} aria-controls={`${id}-slide`} aria-label="Next value"><span>Next</span> →</button>
          </div>
          <p className="values-help">Explore our five commitments. Use the buttons or arrow keys when a control is focused.</p>
        </section>
        <details className="values-program font-body">
          <summary>How we build together</summary>
          <div className="values-program-grid">
            <article><h3>Not a course. A working group.</h3><p>Each cohort is a small group learning side-by-side while building real things. The community is the product — the curriculum is a scaffold toward building on your own.</p></article>
            <article><h3>You don&apos;t do this alone.</h3><p>Working engineers build alongside each cohort and make the shape of a real system easier to see. Accountability over assignments.</p></article>
            <article><h3>We stay in touch.</h3><p>Alumni stay in the loop after the cohort ends. We make it easy to reconnect when life pulls someone away. Some come back as mentors.</p></article>
          </div>
        </details>
      </div>
    </section>
  );
}
