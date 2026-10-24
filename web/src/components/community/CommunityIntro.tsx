import React from "react";
import { communityEntryHref } from "../../lib/community-entry";

const steps = [
  ["01", "Show the work", "Build a profile around your contributions. Add projects, source links, and the opportunities you want to explore."],
  ["02", "Add context", "Mentors can confirm the specific work they have checked. Their notes stay attached to that contribution, not a blanket endorsement of a person."],
  ["03", "Start a conversation", "Approved institutions can explore community profiles and documented work. Evidence gives people a place to start asking better questions."],
];

export default function CommunityIntro({ isAuthenticated = false, full = false }: { isAuthenticated?: boolean; full?: boolean }) {
  const Heading = full ? "h1" : "h2";
  return (
    <section id="community" aria-labelledby="community-heading" className="border-y border-[color:var(--color-rule)] py-16 md:py-24">
      <div className="mx-auto max-w-7xl px-4 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-[1.2fr_1fr] lg:items-end">
          <div>
            <p className="font-body text-xs font-semibold uppercase tracking-[0.3em] text-primary">TTV Community</p>
            <Heading id="community-heading" className="font-heading tracking-heading mt-5 text-4xl leading-tight text-ink-primary sm:text-5xl lg:text-6xl">
              People, with the work<br className="hidden sm:block" /> to tell their story.
            </Heading>
          </div>
          <div>
            <p className="text-lg leading-relaxed text-ink-secondary">For TTV students and builders beyond our cohorts. Share what you have contributed, connect it to evidence, and make your next conversation more informed.</p>
            <p className="mt-4 text-sm leading-relaxed text-ink-muted">You do not need to join or complete a cohort to build a community profile.</p>
            <div className="mt-7 flex flex-wrap items-center gap-5">
              <a href={communityEntryHref(isAuthenticated)} className="inline-flex rounded-full bg-primary px-6 py-3 font-semibold text-dark hover:bg-primary/90">
                {isAuthenticated ? "Open my community journey" : "Join the community"} <span aria-hidden="true" className="ml-2">↗</span>
              </a>
              {!full && <a href="/community" className="font-semibold text-primary underline underline-offset-4">How the community works</a>}
            </div>
            {!isAuthenticated && <p className="mt-3 text-sm text-ink-muted">Continue with GitHub to create your account or sign in.</p>}
          </div>
        </div>
        {full && <>
          <ol className="mt-14 grid gap-px overflow-hidden rounded-xl border border-[color:var(--color-rule)] bg-[color:var(--color-rule)] md:grid-cols-3">
            {steps.map(([number, title, description]) => <li key={number} className="min-w-0 bg-dark p-7 sm:p-8">
              <span className="font-mono text-sm text-primary">{number}</span>
              <h2 className="font-heading mt-6 text-2xl text-ink-primary">{title}</h2>
              <p className="mt-4 leading-relaxed text-ink-secondary">{description}</p>
            </li>)}
          </ol>
          <div className="mt-12 grid gap-8 border-t border-[color:var(--color-rule)] pt-10 md:grid-cols-2">
            <section aria-labelledby="community-visibility-heading">
              <h2 id="community-visibility-heading" className="font-heading text-2xl text-ink-primary">Know who can see your work.</h2>
              <p className="mt-4 leading-relaxed text-ink-secondary">Your community profile and the contributions you save here are available to approved institutions. Mentors can review those shared contributions. Cohort recordings and internal records are not part of institutional discovery.</p>
              <p className="mt-4 leading-relaxed text-ink-muted">A contribution or mentor confirmation does not guarantee a job, placement, or introduction.</p>
            </section>
            <section id="institutions" aria-labelledby="community-institution-heading">
              <h2 id="community-institution-heading" className="font-heading text-2xl text-ink-primary">Exploring talent for an opportunity?</h2>
              <p className="mt-4 leading-relaxed text-ink-secondary">Institutional access needs administrator approval after sign-in. Explore documented work in the community, including members who have not joined a TTV cohort.</p>
              <a href={communityEntryHref(isAuthenticated, true)} className="mt-5 inline-block font-semibold text-primary underline underline-offset-4">Continue to institutional access</a>
              <p className="mt-3 text-sm leading-relaxed text-ink-muted">Signing in does not grant institutional access. The next screen shows whether approval is needed.</p>
            </section>
          </div>
        </>}
      </div>
    </section>
  );
}

export function CommunityJourneyCard() {
  return <section aria-labelledby="dashboard-community-title" className="rounded-xl border border-primary/30 bg-dark p-6 sm:p-8">
    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">Beyond the cohort</p>
    <h2 id="dashboard-community-title" className="mt-3 text-2xl font-semibold text-ink-primary">Your work has a story.</h2>
    <p className="mt-3 leading-relaxed text-ink-secondary">Build your community profile and add the contributions behind it. Open to every member, whether or not you have joined a cohort.</p>
    <div className="mt-5 flex flex-wrap gap-x-6 gap-y-3">
      <a href="/dashboard/community" className="font-semibold text-primary underline underline-offset-4">Open my profile and journey</a>
      <a href="/community" className="text-ink-secondary underline underline-offset-4">About the community</a>
    </div>
  </section>;
}
