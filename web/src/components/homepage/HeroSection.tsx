import { communityEntryHref } from "@/lib/community-entry";

export default function HeroSection({ isAuthenticated = false }: { isAuthenticated?: boolean }) {
  return (
    <section className="home-hero home-container" aria-labelledby="home-title">
      <h1 id="home-title" aria-label="Great builders. Already here." className="home-wordmark">
        <span className="home-wordmark-line"><span><span className="home-title-word">Great</span>{" "}<span className="home-title-word">builders.</span></span></span>
        <span className="home-wordmark-line"><span><span className="home-title-word">Already</span>{" "}<span className="home-title-word">here.</span></span></span>
      </h1>
      <div className="home-invitation">
        <p className="home-description">A practical tech community for early builders across Africa. Learn with working engineers and make your work easier to see—with or without a cohort.</p>
        <div className="home-actions">
          <a className="home-button" href={communityEntryHref(isAuthenticated)}>
            <span>{isAuthenticated ? "Open my journey" : "Join the community"}</span><span className="home-button-arrow" aria-hidden="true">↗</span>
          </a>
          <a className="home-text-link" href="#what-we-do">How it works <span aria-hidden="true">↓</span></a>
        </div>
      </div>
      <div className="home-hero-line" aria-hidden="true" />
    </section>
  );
}
