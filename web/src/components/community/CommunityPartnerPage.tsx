import React from "react";
import CommunitySheet from "./CommunitySheet";
import CommunityTrail from "./CommunityTrail";

export type CommunityPartner = "mentors" | "institutions";

const content = {
  mentors: {
    label: "For mentors", title: "Make the contribution", emphasis: "clearer.",
    lead: "Help someone’s work speak for itself. Add a specific account of what you checked, how you checked it, and what you can confirm.",
    destination: "/dashboard/mentorship", cta: "Continue to mentor review",
    approval: "Mentor access requires administrator approval after sign-in.",
    caption: "A review with a clear scope", foot: "Specific work. A named reviewer. A clear basis.",
    nodes: [
      { label: "The contribution · revision 1", title: "Amina’s low-stock view", text: "“I built the low-stock view and wrote tests for the alert threshold.”" },
      { label: "Grace Njeri · fictional mentor", title: "What I checked", text: "“The low-stock view and its threshold tests.”", detail: "How I checked: read the linked code and reviewed the tests." },
      { label: "A scoped confirmation", title: "Attached to this contribution", text: "The note records the work and revision reviewed.", detail: "Not a certification of the whole person." },
    ],
    journey: "Give the work a second perspective.", intro: "Useful feedback starts with a clear boundary. Confirm only what the evidence lets you support.",
    steps: [
      { title: "Look at the contribution.", text: "Read the member’s description and supporting sources. Separate their own role from the wider team’s work." },
      { title: "Record what you checked.", text: "Describe your observation and review method. Keep the note specific enough for another person to understand its basis." },
      { title: "Keep the context attached.", text: "Your confirmation belongs to that contribution and its reviewed revision. It is not an endorsement of every skill on the profile." },
    ],
    context: "A useful note is a specific note.", contextIntro: "Your perspective can make a contribution easier to understand without promising an outcome.",
    notes: [
      { title: "Show the basis for your confidence.", text: "Say what the source demonstrates and how you reviewed it. Avoid filling gaps with assumptions about the member." },
      { title: "Respect what is shared.", text: "Review shared contributions and sources you are allowed to access. Do not copy private cohort recordings, internal records, or confidential information into a note." },
    ],
    questions: [
      { title: "How much time should I set aside?", text: "Before taking on a review, agree its scope and timing with the team. Start with work you can give careful, specific attention to." },
      { title: "Can I start reviewing as soon as I sign in?", text: "Review tools require mentor access granted by an administrator. Signing in does not grant that access. If it is missing, the mentor page explains the requirement and offers a return to your community journey." },
      { title: "Does my note certify the member?", text: "No. A mentor confirmation records the specific contribution and revision reviewed. It does not certify the whole person or guarantee a job, placement, or introduction." },
    ],
    close: "Bring your perspective to the work.", closeNote: "Administrator-approved mentor access is required. Confirmations stay scoped to reviewed work; they do not guarantee opportunities.",
  },
  institutions: {
    label: "For institutions", title: "Look beyond the profile.", emphasis: "Understand the work.",
    lead: "Explore community members through their contributions, supporting sources, and mentor context. Use the evidence to decide what you want to ask next.",
    destination: "/dashboard/discover", cta: "Continue to institutional access",
    approval: "Institutional access requires administrator approval after sign-in.",
    caption: "From a profile to a better question", foot: "Evidence informs the conversation. People decide.",
    nodes: [
      { label: "Find a starting point", title: "Search by name or skills", text: "Explore community members whose work you want to understand." },
      { label: "Amina Wanjiku · fictional example", title: "Keep the evidence distinct", text: "Member claim: built the low-stock view.", detail: "Source: project code · example only. Mentor note: reviewed the view and threshold tests." },
      { label: "Your next question", title: "“Why should I interview this person?”", text: "Look at the contribution, its sources, and what remains unclear.", detail: "A human question to explore, not an automated recommendation." },
    ],
    journey: "Find the person. Follow the evidence.", intro: "Start with hiring. Explore the work behind a profile and decide what to ask next.",
    steps: [
      { title: "Start with a name or skill.", text: "Search community profiles for a starting point. A listed skill is a claim to explore, not proof of ability." },
      { title: "Understand their part.", text: "Read the contribution, follow its sources, and inspect any mentor confirmation. Keep the member’s claim and the reviewer’s observation distinct." },
      { title: "Decide what to ask next.", text: "Use documented evidence and its gaps to inform your own conversation. Missing evidence is not evidence of low ability." },
    ],
    context: "More context. Your judgment.", contextIntro: "A profile is a starting point. The contribution and its evidence give you something concrete to discuss.",
    notes: [
      { title: "Keep confirmation in scope.", text: "A mentor note describes the particular work reviewed. It is not a universal score, a certification of the person, or a hiring decision." },
      { title: "Approval is not unrestricted access.", text: "Approved institutions can discover saved community profiles and the contributions members share. Private cohort recordings and internal records stay outside institutional discovery." },
    ],
    questions: [
      { title: "Who can use institutional discovery?", text: "Institutional access must be granted by an administrator after sign-in. Signing in alone does not enable discovery. Without that access, the page explains the requirement and links to your community journey." },
      { title: "Does discovery arrange an introduction?", text: "No. Exploring a profile does not send a message, book an interview, or arrange an introduction. Use the documented work to inform your own next steps; participation does not guarantee a job or placement." },
    ],
    close: "Start with evidence. Ask a better question.", closeNote: "Administrator-approved institutional access is required. Discovery preserves private-data boundaries and does not guarantee hiring outcomes or introductions.",
  },
} as const;

export default function CommunityPartnerPage({ audience, isAuthenticated = false }: { audience: CommunityPartner; isAuthenticated?: boolean }) {
  const page = content[audience];
  const href = isAuthenticated ? page.destination : `/auth/login?next=${encodeURIComponent(page.destination)}`;
  return <article className={`community-audience hp audience-${audience}`} data-community-root>
      <nav className="audience-breadcrumb audience-container" aria-label="Breadcrumb"><a href="/community">← Community</a><span aria-current="page">{page.label}</span></nav>
      <CommunitySheet className="audience-hero" labelledby="audience-title" tone="base" layer={1}>
        <div className="audience-hero-copy"><h1 id="audience-title">{page.title} <em>{page.emphasis}</em></h1><p className="audience-lead">{page.lead}</p><a className="audience-button" href={href}>{page.cta}<span aria-hidden="true">↗</span></a><p className="audience-cta-note">{page.approval}{!isAuthenticated && " Continue with GitHub to sign in."}</p><a className="audience-text-link" href="#participation">See how it works <span aria-hidden="true">↓</span></a></div>
        <CommunityTrail story={audience}><figcaption id="trail-caption">{page.caption}<span>Fictional illustration</span></figcaption><ol className="audience-evidence-path">{page.nodes.map((node, i) => <li key={node.label} className={i === 2 ? "audience-mentor-note" : undefined}><span className="audience-node" aria-hidden="true">{audience === "mentors" ? "○" : "◇"}</span><div><span className="audience-card-label">{node.label}</span><h3>{node.title}</h3><p>{node.text}</p>{"detail" in node && <small>{node.detail}</small>}</div></li>)}</ol><p className="audience-trail-foot">{page.foot}</p></CommunityTrail>
      </CommunitySheet>
      <CommunitySheet className="audience-journey" id="participation" labelledby="journey-title" tone="raised" layer={2}><div className="audience-section-intro"><h2 id="journey-title">{page.journey}</h2><p>{page.intro}</p></div><ol className="audience-steps">{page.steps.map((step, i) => <li key={step.title}><span aria-hidden="true">0{i + 1}</span><h3>{step.title}</h3><p>{step.text}</p></li>)}</ol></CommunitySheet>
      <CommunitySheet className="audience-context" labelledby="context-title" tone="lift" layer={3}><div><h2 id="context-title">{page.context}</h2><p>{page.contextIntro}</p></div><div className="audience-context-notes">{page.notes.map(note => <div key={note.title}><h3>{note.title}</h3><p>{note.text}</p></div>)}</div></CommunitySheet>
      <CommunitySheet className="audience-questions" labelledby="questions-title" tone="deep" layer={4}><h2 id="questions-title">Before you begin.</h2><div>{page.questions.map(question => <details key={question.title}><summary>{question.title}</summary><p>{question.text}</p></details>)}</div></CommunitySheet>
      <CommunitySheet className="audience-close" labelledby="close-title" tone="peach" layer={5} last><span className="audience-close-mark" aria-hidden="true">↗</span><div><h2 id="close-title">{page.close}</h2><a className="audience-button" href={href}>{page.cta}<span aria-hidden="true">↗</span></a><p>{page.closeNote}</p></div></CommunitySheet>
  </article>;
}
