const pathways = [
  { audience: "Members", copy: "Document your projects and your part in them.", href: "/community/members", link: "For members", stage: "contribution" },
  { audience: "Mentors", copy: "Add context to work you have actually checked. Mentor access requires approval.", href: "/community/mentors", link: "For mentors", stage: "mentor" },
  { audience: "Institutions", copy: "Explore the work behind a profile. Institutional access requires approval.", href: "/community/institutions", link: "For institutions", stage: "question" },
];

export default function PathwaysSection() {
  return (
    <section id="what-we-do" className="home-section home-container home-story" aria-labelledby="home-how-heading">
      <div className="home-story-copy">
        <div className="home-section-intro" data-home-reveal>
          <h2 id="home-how-heading" className="home-heading">Build it.<br /><span>Show your part.</span></h2>
          <p className="home-explanation">A project tells one story. Your contribution tells another. Bring the work, add context, and give people a better place to start a conversation.</p>
          <a className="home-text-link" href="/community">How the community works <span aria-hidden="true">↗</span></a>
        </div>
        <nav aria-label="Find your place at Tembo" className="home-pathways">
          {pathways.map((pathway) => (
            <a key={pathway.href} href={pathway.href} className="home-pathway" aria-label={pathway.link} data-home-stage={pathway.stage}>
              <span className="home-pathway-body"><span className="home-audience">{pathway.audience}</span><span className="home-pathway-copy">{pathway.copy}</span></span>
              <span className="home-pathway-link" aria-hidden="true"><span className="home-arrow">↗</span></span>
            </a>
          ))}
        </nav>
      </div>
      <figure className="home-evidence" aria-labelledby="home-example-caption">
        <figcaption id="home-example-caption">A contribution, in context.<span>Fictional illustration</span></figcaption>
        <div className="home-evidence-paper">
          <div className="home-example-person"><span className="home-example-avatar" aria-hidden="true">AN</span><div><p>Amina Njeri</p><span>Community member · fictional example</span></div></div>
          <p className="home-example-project">A market inventory app.</p>
          <div className="home-evidence-thread">
            <div className="home-evidence-item" data-evidence-stage="contribution" data-home-reveal>
              <span className="home-evidence-dot" aria-hidden="true" />
              <p className="home-evidence-label">The contribution</p>
              <p>“I built the stock-tracking API and wrote the tests for it.”</p>
              <span className="home-evidence-detail">Amina’s project notes</span>
            </div>
            <div className="home-evidence-item" data-evidence-stage="mentor" data-home-reveal>
              <span className="home-evidence-dot" aria-hidden="true" />
              <p className="home-evidence-label">The mentor’s context</p>
              <p>“I reviewed those changes with Amina. She can explain the trade-offs.”</p>
              <span className="home-evidence-detail">Kamau Otieno · fictional mentor</span>
            </div>
            <div className="home-evidence-item" data-evidence-stage="question" data-home-reveal>
              <span className="home-evidence-dot" aria-hidden="true" />
              <p className="home-evidence-label">A better first question</p>
              <p>“How did you decide what to test?”</p>
              <span className="home-evidence-detail">An institution’s conversation starter</span>
            </div>
          </div>
        </div>
      </figure>
    </section>
  );
}
