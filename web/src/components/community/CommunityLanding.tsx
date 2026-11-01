import React from "react";
import CommunitySheet from "./CommunitySheet";
import { communityEntryHref } from "../../lib/community-entry";

const paths = [
  { slug: "members", label: "For members", title: "Build your story.", text: "Turn the things you make into a picture of what you can contribute. Start with one piece of work.", shape: "●", detail: "With or without a cohort." },
  { slug: "mentors", label: "For mentors", title: "Add perspective.", text: "Help make someone’s contribution clearer. Share what you checked, how you checked it, and what you saw.", shape: "○", detail: "Specific work. Thoughtful review." },
  { slug: "institutions", label: "For institutions", title: "Follow the evidence.", text: "Get to know the work behind a profile. Explore contributions and mentor context, then decide what to ask next.", shape: "◇", detail: "Access approved by the team." },
];

/** Server-rendered navigation: the map is an illustration, never a people directory. */
export default function CommunityLanding({ isAuthenticated = false }: { isAuthenticated?: boolean }) {
  return <article className="community-audience hp community-landing" data-community-root>
      <CommunitySheet tone="base" layer={1} className="community-opening" labelledby="community-title">
        <div className="community-opening-copy">
          <h1 id="community-title">Good work.<br /><em>Better together.</em></h1>
          <p className="audience-lead">An African tech community, starting in East Africa and Nigeria. A place for builders, mentors, and institutions to connect through the work.</p>
          <a className="audience-button" href={communityEntryHref(isAuthenticated)}>{isAuthenticated ? "Open my community journey" : "Join the community"}<span aria-hidden="true">→</span></a>
          <p className="audience-cta-note">You do not need to join or complete a cohort.{!isAuthenticated && " Continue with GitHub to join or sign in."}</p>
          <a className="audience-text-link" href="#your-place">Find your place <span aria-hidden="true">↓</span></a>
        </div>
        <figure className="community-deck">
          <svg className="community-deck-network" aria-hidden="true" viewBox="0 0 500 500" fill="none"><ellipse cx="250" cy="250" rx="235" ry="165"/><ellipse cx="250" cy="250" rx="180" ry="230"/><path d="M40 300 165 80 380 140 440 350 200 430Z"/><circle cx="165" cy="80" r="7"/><circle cx="440" cy="350" r="9"/></svg>
          <div className="community-deck-card deck-build"><span>Builders</span><strong>Make something.</strong><span className="deck-glyph" aria-hidden="true">●</span></div>
          <div className="community-deck-card deck-review"><span>Mentors</span><strong>Add perspective.</strong><span className="deck-glyph" aria-hidden="true">○</span></div>
          <div className="community-deck-card deck-connect"><span>Institutions</span><strong>See the work.</strong><span className="deck-glyph" aria-hidden="true">◇</span></div>
          <figcaption>Different perspectives. Connected through the work.</figcaption>
        </figure>
      </CommunitySheet>
      <CommunitySheet className="community-paths" labelledby="paths-title" tone="raised" layer={2} id="your-place">
        <div className="audience-section-intro"><h2 id="paths-title">Find your place.<br /><em>Bring your perspective.</em></h2><p>Different starting points. One shared belief: the work tells a richer story when we understand it together.</p></div>
        <nav aria-label="Community participation" className="community-path-grid">{paths.map(path => <a className={`community-path path-${path.slug}`} href={`/community/${path.slug}`} key={path.slug} aria-label={path.label}><span className="path-symbol" aria-hidden="true">{path.shape}</span><span className="path-label">{path.label}</span><h3>{path.title}</h3><p>{path.text}</p><span className="path-foot">{path.detail}<span aria-hidden="true">↗</span></span></a>)}</nav>
      </CommunitySheet>
      <CommunitySheet className="community-common" labelledby="common-title" tone="map" layer={3}><h2 id="common-title">The work is<br /><em>the starting point.</em></h2><ol><li><h3>Show what you made.</h3><p>A project, a contribution, a source. Explain your part and what you want to explore next.</p></li><li><h3>Add another perspective.</h3><p>Mentors can confirm the specific work they checked. Their notes stay with the contribution, not a blanket endorsement of a person.</p></li><li><h3>Ask a better question.</h3><p>Approved institutions can explore documented work. Evidence gives people a place to start a conversation.</p></li></ol></CommunitySheet>
      <CommunitySheet className="audience-context" labelledby="visibility-title" tone="lift" layer={4}><div><h2 id="visibility-title">Shared work.<br /><em>Clear boundaries.</em></h2><p>Approved institutions can discover your saved community profile and the contributions you share. Mentors can review shared contributions.</p></div><div className="audience-context-notes"><div><h3>Your private learning stays private.</h3><p>Cohort recordings and internal records are not part of institutional discovery.</p></div><div><h3>A starting point, not a promise.</h3><p>Participation does not guarantee a job, placement, or introduction. People decide what happens next.</p></div></div></CommunitySheet>
      <CommunitySheet id="institutions" className="audience-close" labelledby="community-institution-heading" tone="peach" layer={5} last><span className="audience-close-mark" aria-hidden="true">◇</span><div><h2 id="community-institution-heading">Bring your work.<br />Find your people.</h2><a className="audience-button" href={communityEntryHref(isAuthenticated)}>Start your community journey <span aria-hidden="true">→</span></a><br /><a className="audience-text-link" href={communityEntryHref(isAuthenticated, true)}>Continue to institutional access <span aria-hidden="true">↗</span></a><p>Institutional access requires administrator approval after sign-in.</p></div></CommunitySheet>
  </article>;
}
