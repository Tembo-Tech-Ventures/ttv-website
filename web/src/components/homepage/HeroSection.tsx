import { communityEntryHref } from "@/lib/community-entry";

export default function HeroSection({ isAuthenticated = false }: { isAuthenticated?: boolean }) {
  return (
    <section className="home-hero home-container" aria-labelledby="home-title">
      <h1 id="home-title" aria-label="Tembo Tech Ventures" className="home-wordmark font-heading tracking-display">
        TEMBO
      </h1>
      <p className="home-signature" aria-hidden="true">Tech Ventures</p>
      <div className="home-hero-bottom">
        <p className="home-lead">Great builders<br />are already here.</p>
        <div className="home-invitation">
          <p>A practical tech community for early builders across Africa. Learn with working engineers and make your work easier to see.</p>
          <div className="home-actions">
            <a className="home-button" href={communityEntryHref(isAuthenticated)}>
              {isAuthenticated ? "Open my journey" : "Join the community"}<span aria-hidden="true">↗</span>
            </a>
            <a className="home-text-link" href="#what-we-do">How it works <span aria-hidden="true">↓</span></a>
          </div>
          <p className="home-caption">Open with or without a cohort.</p>
        </div>
      </div>
    </section>
  );
}
