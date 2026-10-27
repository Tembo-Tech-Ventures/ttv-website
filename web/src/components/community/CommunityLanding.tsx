import React from "react";
import { communityEntryHref } from "../../lib/community-entry";

const paths = [
  { slug: "members", label: "For members", title: "Build your story.", text: "Turn the things you make into a picture of what you can contribute. Start with one piece of work.", shape: "●", detail: "With or without a cohort." },
  { slug: "mentors", label: "For mentors", title: "Add perspective.", text: "Help make someone’s contribution clearer. Share what you checked, how you checked it, and what you saw.", shape: "○", detail: "Specific work. Thoughtful review." },
  { slug: "institutions", label: "For institutions", title: "Follow the evidence.", text: "Get to know the work behind a profile. Explore contributions and mentor context, then decide what to ask next.", shape: "◇", detail: "Access approved by the team." },
];

/** Server-rendered navigation: the map is an illustration, never a people directory. */
export default function CommunityLanding({ isAuthenticated = false }: { isAuthenticated?: boolean }) {
  return <article className="community-audience community-landing">
    <div className="audience-container">
      <section className="community-opening" aria-labelledby="community-title">
        <h1 id="community-title">Good work.<br /><em>Better together.</em></h1>
        <div className="community-opening-bottom"><p className="audience-lead">An African tech community, starting in East Africa and Nigeria. A place for builders, mentors, and institutions to connect through the work.</p><div><a className="audience-button" href={communityEntryHref(isAuthenticated)}>{isAuthenticated ? "Open my community journey" : "Join the community"}<span aria-hidden="true">↗</span></a><p className="audience-cta-note">You do not need to join or complete a cohort.{!isAuthenticated && " Continue with GitHub to join or sign in."}</p></div></div>
      </section>
      <div className="community-map" aria-hidden="true">
        <svg viewBox="0 0 1100 260" fill="none"><path d="M40 200H220L365 70H570L725 200H1060M220 200H530L690 65H920M365 70L530 200M725 200L920 65" /><circle cx="220" cy="200" r="13"/><circle cx="365" cy="70" r="13"/><circle cx="530" cy="200" r="13"/><circle cx="570" cy="70" r="21" className="map-mentor"/><circle cx="690" cy="65" r="21" className="map-mentor"/><path className="map-partner" d="m725 180 20 20-20 20-20-20ZM920 45l20 20-20 20-20-20Z"/><circle className="map-pulse" cx="365" cy="70" r="28"/></svg>
        <span className="map-word map-word-build">Build.</span><span className="map-word map-word-share">Share.</span><span className="map-word map-word-connect">Connect.</span>
      </div>
      <section className="community-paths" aria-labelledby="paths-title">
        <div className="audience-section-intro"><h2 id="paths-title">Find your place.<br /><em>Bring your perspective.</em></h2><p>Different starting points. One shared belief: the work tells a richer story when we understand it together.</p></div>
        <nav aria-label="Community participation" className="community-path-grid">{paths.map(path => <a className={`community-path path-${path.slug}`} href={`/community/${path.slug}`} key={path.slug} aria-label={path.label}><span className="path-symbol" aria-hidden="true">{path.shape}</span><span className="path-label">{path.label}</span><h3>{path.title}</h3><p>{path.text}</p><span className="path-foot">{path.detail}<span aria-hidden="true">↗</span></span></a>)}</nav>
      </section>
      <section className="community-common" aria-labelledby="common-title"><h2 id="common-title">The work is<br /><em>the starting point.</em></h2><ol><li><h3>Show what you made.</h3><p>A project, a contribution, a source. Explain your part and what you want to explore next.</p></li><li><h3>Add another perspective.</h3><p>Mentors can confirm the specific work they checked. Their notes stay with the contribution, not a blanket endorsement of a person.</p></li><li><h3>Ask a better question.</h3><p>Approved institutions can explore documented work. Evidence gives people a place to start a conversation.</p></li></ol></section>
      <section className="audience-context" aria-labelledby="visibility-title"><div><h2 id="visibility-title">Shared work.<br /><em>Clear boundaries.</em></h2><p>Your community profile and contributions are available to approved institutions. Mentors can review shared contributions.</p></div><div className="audience-context-notes"><div><h3>Your private learning stays private.</h3><p>Cohort recordings and internal records are not part of institutional discovery.</p></div><div><h3>A starting point, not a promise.</h3><p>Participation does not guarantee a job, placement, or introduction. People decide what happens next.</p></div></div></section>
      <section id="institutions" className="audience-close" aria-labelledby="community-institution-heading"><span className="audience-close-mark" aria-hidden="true">◇</span><div><h2 id="community-institution-heading">People behind the profiles.<br />Evidence behind the work.</h2><a className="audience-button" href={communityEntryHref(isAuthenticated, true)}>Continue to institutional access <span aria-hidden="true">↗</span></a><p>Institutional access requires administrator approval after sign-in.</p></div></section>
    </div>
  </article>;
}
