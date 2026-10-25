import { VALUES } from "./values";
import ValueWord from "./ValueWord";
// oxlint-disable-next-line import/no-unassigned-import -- Shared responsive value typography.
import "./values.css";

export default function ValuesSection() {
  return (
    <section id="values" className="relative px-4 py-28 sm:px-8 md:py-36">
      <div className="mx-auto max-w-7xl">
        <div className="mb-16 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <p className="font-body text-xs font-semibold uppercase tracking-[0.4em] text-primary">
            § 02 Values as commitments
          </p>
          <p className="max-w-md font-body text-base text-ink-secondary md:text-lg">
            Abstract nouns are easy. These are the five things we&apos;ll actually put in writing.
          </p>
        </div>
        <ul className="divide-y divide-[color:var(--color-rule)] border-y border-[color:var(--color-rule)]">
          {VALUES.map((value) => (
            <li key={value.word} className="value-commitment-row">
              <ValueWord word={value.word} outlined />
              <p className="value-commitment-copy font-body text-ink-primary">{value.commitment}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
