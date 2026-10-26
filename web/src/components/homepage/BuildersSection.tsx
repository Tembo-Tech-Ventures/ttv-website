interface Builder {
  handle: string;
  name: string;
  image: string | null;
  initials: string;
  label: string;
}

/** Only eligible public identities are supplied by HumansSection's server query. */
export default function BuildersSection({ profiles }: { profiles: Builder[] }) {
  if (profiles.length === 0) return null;
  return (
    <section aria-labelledby="humans-heading" className="relative px-4 py-16 sm:px-8 md:py-20">
      <div className="mx-auto max-w-7xl">
        <div className="mb-10 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <h2 id="humans-heading" className="font-heading tracking-heading text-3xl text-ink-primary md:text-5xl">Meet the builders.</h2>
          <a href="/talent" className="inline-flex min-h-11 items-center font-body text-primary underline underline-offset-4">Explore the builder directory →</a>
        </div>
        <ul className="grid grid-cols-2 gap-4 sm:gap-6 md:grid-cols-4">
          {profiles.map((card) => (
            <li key={card.handle} className="space-y-3">
              <a href={`/talent/${card.handle}`} className="block" aria-label={`Meet ${card.name}`}>
                <div className="relative aspect-[4/5] overflow-hidden border border-[color:var(--color-rule)]" style={{ backgroundColor: "var(--color-bg-raised)" }}>
                  {card.image ? <img src={card.image} alt="" className="h-full w-full object-cover" loading="lazy" /> : (
                    <div className="flex h-full w-full items-center justify-center">
                      <span className="font-heading tracking-display text-primary" style={{ fontSize: "clamp(3rem, 7vw, 6rem)" }}>{card.initials}</span>
                    </div>
                  )}
                </div>
              </a>
              <p className="font-body text-sm font-semibold text-ink-primary">{card.name}</p>
              {card.label && <p className="font-body text-xs font-semibold uppercase tracking-[0.24em] text-ink-muted">{card.label}</p>}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
