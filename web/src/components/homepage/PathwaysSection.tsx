const pathways = [
  { audience: "Members", title: "Show what you bring.", copy: "Build a profile around your projects, your part in them, and what you want to do next. No cohort required.", href: "/community/members", link: "For members" },
  { audience: "Mentors", title: "Put experience to work.", copy: "Review a contribution and add context about the work you have actually checked.", href: "/community/mentors", link: "For mentors" },
  { audience: "Institutions", title: "Get to know the work.", copy: "Explore people through their contributions and supporting evidence. Institutional access requires approval.", href: "/community/institutions", link: "For institutions" },
];

export default function PathwaysSection() {
  return (
    <section id="what-we-do" className="home-section home-container" aria-labelledby="home-how-heading">
      <div className="home-section-intro">
        <h2 id="home-how-heading" className="home-heading">Build it.<br /><span>Show your part.</span></h2>
        <div className="home-explanation">
          <p>In a cohort, you learn alongside other builders and working engineers. In the wider community, you document what you contributed, link to the work, and invite mentors to add context.</p>
          <p>That gives approved institutions something concrete to explore, and a better place to start a conversation.</p>
          <a className="home-text-link" href="/community">How the community works <span aria-hidden="true">↗</span></a>
        </div>
      </div>
      <nav aria-label="Find your place at Tembo" className="home-pathways">
        {pathways.map((pathway) => (
          <a key={pathway.href} href={pathway.href} className="home-pathway">
            <span className="home-audience">{pathway.audience}</span>
            <span className="home-pathway-body"><span className="home-pathway-title">{pathway.title}</span><span className="home-pathway-copy">{pathway.copy}</span></span>
            <span className="home-pathway-link">{pathway.link}<span className="home-arrow" aria-hidden="true">↗</span></span>
          </a>
        ))}
      </nav>
    </section>
  );
}
