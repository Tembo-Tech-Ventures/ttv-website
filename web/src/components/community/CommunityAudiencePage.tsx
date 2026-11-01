import React from "react";
import CommunitySheet from "./CommunitySheet";
import CommunityTrail from "./CommunityTrail";
import { communityEntryHref } from "../../lib/community-entry";

const steps = [
  { title: "Start with something you made.", text: "A project, a small improvement, a piece of a team effort. Explain what you contributed and why it mattered." },
  { title: "Let the evidence add context.", text: "Connect your contribution to a source. A mentor can record what they checked about that specific work." },
  { title: "Say what comes next.", text: "Share your interests and opportunity goals. Approved institutions can discover your saved community profile and the contributions you share." },
];

function ContributionTrail() {
  return <CommunityTrail story="members">
    <figcaption id="trail-caption">An example of work with context <span>Fictional illustration</span></figcaption>
    <div className="audience-person"><span className="audience-avatar" aria-hidden="true">AW</span><div><strong>Amina Wanjiku</strong><span>Community member · fictional example</span></div></div>
    <ol className="audience-evidence-path">
      <li><span className="audience-node" aria-hidden="true">●</span><div><span className="audience-card-label">The project</span><h3>A clearer way to track stock.</h3><p>A small inventory app for a fictional shop.</p></div></li>
      <li><span className="audience-node" aria-hidden="true">●</span><div><span className="audience-card-label">Amina’s contribution</span><p className="audience-example-claim">“I built the low-stock view and wrote tests for the alert threshold.”</p><span className="audience-source"><span aria-hidden="true">↗</span> Project source · example only</span></div></li>
      <li className="audience-mentor-note"><span className="audience-node" aria-hidden="true">○</span><div><span className="audience-card-label">A mentor can add context</span><p>“I reviewed the low-stock view and its tests.”</p><small>Confirms the contribution reviewed, not the whole person.</small></div></li>
    </ol>
    <p className="audience-trail-foot">The work. Your part. Something to talk about.</p>
  </CommunityTrail>;
}

export default function CommunityAudiencePage({ isAuthenticated = false }: { isAuthenticated?: boolean }) {
  const href = communityEntryHref(isAuthenticated);
  const cta = isAuthenticated ? "Open my community journey" : "Build your community profile";
  return <article className="community-audience hp audience-members" data-community-root>
      <nav className="audience-breadcrumb audience-container" aria-label="Breadcrumb"><a href="/community">← Community</a><span aria-current="page">For members</span></nav>
      <CommunitySheet className="audience-hero" labelledby="audience-title" tone="base" layer={1}>
        <div className="audience-hero-copy">
          <h1 id="audience-title">Give your work <em>a story.</em></h1>
          <p className="audience-lead">You are more than a list of skills. Show what you have made, the part you played, and where you want to go.</p>
          <a className="audience-button" href={href}>{cta}<span aria-hidden="true">↗</span></a>
          <p className="audience-cta-note">Open to builders within and beyond TTV cohorts. Approved institutions can discover your saved community profile and the contributions you share.{!isAuthenticated && " Continue with GitHub to join or sign in."}</p>
          <a className="audience-text-link" href="#your-first-contribution">See how it works <span aria-hidden="true">↓</span></a>
        </div>
        <ContributionTrail />
      </CommunitySheet>
      <CommunitySheet className="audience-journey" id="your-first-contribution" labelledby="journey-title" tone="raised" layer={2}>
        <div className="audience-section-intro"><h2 id="journey-title">Small beginnings.<br />A fuller picture.</h2><p>You do not need a perfect portfolio or a completed cohort. Start with one contribution you can explain.</p></div>
        <ol className="audience-steps">{steps.map((step, i) => <li key={step.title}><span aria-hidden="true">0{i + 1}</span><h3>{step.title}</h3><p>{step.text}</p></li>)}</ol>
      </CommunitySheet>
      <CommunitySheet className="audience-context" labelledby="context-title" tone="lift" layer={3}>
        <div><h2 id="context-title">Your contribution,<br /><em>in context.</em></h2><p>A link shows where to look. Your words explain your part. A mentor’s note adds what they have checked.</p></div>
        <div className="audience-context-notes"><div><h3>Add a mentor’s perspective.</h3><p>Mentor confirmation stays attached to the specific work reviewed. It is not a blanket endorsement of your skills or a promise of a job.</p></div><div><h3>Help institutions understand your work.</h3><p>Saved community profiles and contributions are available to approved institutions, and mentors can review shared contributions. Private cohort recordings and internal records stay outside institutional discovery.</p></div></div>
      </CommunitySheet>
      <CommunitySheet className="audience-questions" labelledby="questions-title" tone="deep" layer={4}><h2 id="questions-title">Before you begin.</h2><div><details><summary>What can I share?</summary><p>Describe a project or contribution and add a source you have permission to share. Explain your own role in team work. Keep private information out of your profile and linked evidence.</p></details><details><summary>Do I need to join a TTV cohort?</summary><p>No. Community profiles are open to members with or without a cohort. Cohort applications and access to cohort learning materials remain separate.</p></details></div></CommunitySheet>
      <CommunitySheet className="audience-close" labelledby="close-title" tone="peach" layer={5} last><span className="audience-close-mark" aria-hidden="true">↗</span><div><h2 id="close-title">Start with your work.<br />See where the conversation goes.</h2><a className="audience-button" href={href}>{cta}<span aria-hidden="true">↗</span></a><p>Approved institutions can discover your saved community profile and the contributions you share. Shared contributions are available for mentor review. Participation does not guarantee a job, placement, or introduction.</p></div></CommunitySheet>
  </article>;
}
