import React, { useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  ArrowRight,
  MagnifyingGlass,
  Sparkle,
  CheckCircle,
  Link as LinkIcon,
} from "@phosphor-icons/react";
import DiscoveryShell from "./DiscoveryShell";
import { evidenceHref, filterDemoProfiles } from "./types";
import type {
  CommunityProfile,
  EvidenceAnswer,
  EvidenceSource,
  ScoutCriteria,
} from "./types";

interface Props {
  profiles: CommunityProfile[];
  demo?: boolean;
  onSearch?: (criteria: ScoutCriteria) => Promise<CommunityProfile[]>;
  onAsk?: (
    profileId: string,
    question: string,
    criteria: ScoutCriteria,
  ) => Promise<EvidenceAnswer>;
}

export function EvidenceLinks({ sources }: { sources: EvidenceSource[] }) {
  return (
    <ul className="discovery-sources">
      {sources.map((source) => {
        const href = evidenceHref(source.url);
        return (
          <li key={source.id}>
            {href ? (
              <a href={href} target="_blank" rel="noopener noreferrer">
                <LinkIcon size={15} aria-hidden="true" />
                <span>
                  {source.title}
                  <small>{source.kind}</small>
                </span>
                <ArrowUpRight size={15} aria-hidden="true" />
              </a>
            ) : (
              <span>
                {source.title} <small>Source link unavailable</small>
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function ProfileEvidence({
  profile,
  criteria,
  demo,
  onAsk,
}: {
  profile: CommunityProfile;
  criteria: ScoutCriteria;
  demo: boolean;
  onAsk?: Props["onAsk"];
}) {
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<EvidenceAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const asking = useRef(false);
  const [askedQuestion, setAskedQuestion] = useState("");
  async function ask(event: FormEvent) {
    event.preventDefault();
    if (!question.trim() || asking.current) return;
    asking.current = true;
    setBusy(true);
    setError("");
    setAnswer(null);
    setAskedQuestion(question.trim());
    try {
      if (onAsk) setAnswer(await onAsk(profile.id, question.trim(), criteria));
      else if (demo)
        setAnswer({
          text: `Sample response: ${profile.name}'s profile contains ${profile.claims.length} member-reported entries and ${profile.claims.flatMap((claim) => claim.evidence).length} attached sources. Review the sources for their specific contribution. A source count does not establish quality, production scale, or experience beyond the documented work. Ask about those gaps directly.`,
          sources: profile.claims
            .flatMap((claim) => claim.evidence)
            .slice(0, 2),
        });
      else
        throw new Error(
          "Evidence chat is not available right now. Your question is still here; try again shortly.",
        );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "We could not answer that question. Please try again.",
      );
    } finally {
      setBusy(false);
      asking.current = false;
    }
  }
  return (
    <div className="discovery-profile-grid">
      <section
        className="discovery-profile"
        aria-label={`${profile.name}'s profile`}
      >
        <div className="discovery-profile-top">
          <div
            className="discovery-avatar discovery-avatar-large"
            aria-hidden="true"
          >
            {profile.name
              .split(" ")
              .map((part) => part[0])
              .slice(0, 2)
              .join("")}
          </div>
          <span className="discovery-eyebrow">Community profile</span>
        </div>
        <h1>{profile.name}</h1>
        <p className="discovery-profile-headline">{profile.headline}</p>
        <p className="discovery-muted">{profile.location}</p>
        <p className="discovery-about">{profile.about}</p>
        <div className="discovery-goal">
          <span className="discovery-eyebrow">Looking toward</span>
          <p>{profile.goal}</p>
        </div>
        <div className="discovery-section-heading">
          <h2>The work behind the profile</h2>
          <span>{profile.claims.length} entries</span>
        </div>
        <p className="discovery-muted">
          Member contributions and the sources behind them. Confirmations apply
          to the named work only.
        </p>
        <ol className="discovery-timeline">
          {profile.claims.map((claim) => (
            <li key={claim.id}>
              <time dateTime={claim.date}>{claim.date}</time>
              <h3>{claim.title}</h3>
              <p>{claim.description}</p>
              <div className="discovery-tags">
                {claim.skills.map((skill) => (
                  <span key={skill}>{skill}</span>
                ))}
              </div>
              {claim.evidence.length > 0 ? (
                <EvidenceLinks sources={claim.evidence} />
              ) : (
                <p className="discovery-empty-note">
                  No supporting source attached yet. This is missing evidence,
                  not a negative assessment.
                </p>
              )}
              {claim.confirmation ? (
                <div className="discovery-confirmation">
                  <CheckCircle size={19} aria-hidden="true" />
                  <div>
                    <strong>Checked by {claim.confirmation.mentorName}</strong>
                    <p>{claim.confirmation.note}</p>
                    <small>
                      {claim.confirmation.date} · Claim-specific confirmation
                    </small>
                  </div>
                </div>
              ) : (
                <p className="discovery-provenance">
                  Member-reported · Not yet confirmed by a mentor
                </p>
              )}
            </li>
          ))}
        </ol>
        {profile.claims.length === 0 && (
          <p className="discovery-empty-note">
            This member has not added journey evidence yet.
          </p>
        )}
      </section>
      <aside className="discovery-chat" aria-label="Explore profile evidence">
        <div className="discovery-chat-title">
          <Sparkle size={22} aria-hidden="true" />
          <span className="discovery-eyebrow">Go beyond the headline</span>
        </div>
        <h2>Ask about the work.</h2>
        <p>
          Explore this person's contributions, sources, and what still needs a
          conversation.
        </p>
        <div className="discovery-question-suggestions">
          {[
            "What evidence supports their skills?",
            "What should I ask them next?",
          ].map((prompt) => (
            <button
              type="button"
              key={prompt}
              onClick={() => setQuestion(prompt)}
            >
              {prompt}
              <ArrowUpRight size={16} aria-hidden="true" />
            </button>
          ))}
        </div>
        <form onSubmit={ask} className="discovery-chat-form">
          <label htmlFor="evidence-question">Your question</label>
          <textarea
            id="evidence-question"
            maxLength={2000}
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="What did they contribute to this project?"
            rows={4}
            required
          />
          <button
            className="discovery-button"
            disabled={busy || !question.trim()}
          >
            {busy ? "Looking at the evidence…" : "Explore evidence"}
            <ArrowRight size={18} aria-hidden="true" />
          </button>
        </form>
        {error && (
          <p role="alert" className="discovery-error">
            {error}
          </p>
        )}
        {answer && (
          <output className="discovery-answer">
            <span className="discovery-eyebrow">
              {demo ? "Sample answer · demo" : "Evidence response"}
            </span>
            <h3>{askedQuestion}</h3>
            <p>{answer.text}</p>
            <EvidenceLinks sources={answer.sources} />
          </output>
        )}
        <p className="discovery-chat-note">
          An assistant response is not a mentor confirmation. Check the linked
          sources and ask about what is missing.
        </p>
      </aside>
    </div>
  );
}

export default function ScoutWorkspace({
  profiles,
  demo = false,
  onSearch,
  onAsk,
}: Props) {
  const [criteria, setCriteria] = useState<ScoutCriteria>({
    context: "",
    skills: "",
    query: "",
  });
  const [results, setResults] = useState(profiles);
  const [selected, setSelected] = useState<CommunityProfile | null>(null);
  const [step, setStep] = useState<"criteria" | "results">("criteria");
  const [busy, setBusy] = useState(false);
  const searching = useRef(false);
  const [error, setError] = useState("");
  const [appliedCriteria, setAppliedCriteria] = useState(criteria);
  async function search(event: FormEvent) {
    event.preventDefault();
    if (searching.current) return;
    searching.current = true;
    setBusy(true);
    setError("");
    try {
      if (onSearch) setResults(await onSearch(criteria));
      else if (demo) setResults(filterDemoProfiles(profiles, criteria));
      else
        throw new Error(
          "Search is unavailable right now. Your criteria are saved in this form; please try again.",
        );
      setAppliedCriteria({ ...criteria });
      setStep("results");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Search could not be completed. Please try again.",
      );
    } finally {
      setBusy(false);
      searching.current = false;
    }
  }
  return (
    <DiscoveryShell active="scout" demo={demo}>
      {selected ? (
        <>
          <button
            className="discovery-text-button discovery-return"
            onClick={() => setSelected(null)}
          >
            <ArrowLeft size={18} aria-hidden="true" />
            Back to people
          </button>
          <ProfileEvidence
            key={selected.id}
            profile={selected}
            criteria={appliedCriteria}
            demo={demo}
            onAsk={onAsk}
          />
        </>
      ) : (
        <>
          <div className="discovery-page-heading">
            <div>
              <span className="discovery-eyebrow">
                Institution workspace / discover
              </span>
              <h1>
                Find the person.
                <br />
                <em>See the work.</em>
              </h1>
            </div>
            <p>
              Start with what matters to your team.
              <br />
              Meet community builders through their
              <br className="discovery-desktop-break" /> projects, progress, and
              evidence.
            </p>
          </div>
          <ol className="discovery-steps" aria-label="Scouting steps">
            <li aria-current={step === "criteria" ? "step" : undefined}>
              <span>01</span>Define what matters
            </li>
            <li aria-current={step === "results" ? "step" : undefined}>
              <span>02</span>Explore the evidence
            </li>
          </ol>
          {step === "criteria" ? (
            <section className="discovery-criteria-grid">
              <form className="discovery-criteria" onSubmit={search}>
                <span className="discovery-eyebrow">
                  Your search, in your words
                </span>
                <h2>Who would move your work forward?</h2>
                <label className="discovery-field">
                  What are you working on?
                  <textarea
                    value={criteria.context}
                    onChange={(event) =>
                      setCriteria({ ...criteria, context: event.target.value })
                    }
                    maxLength={4000}
                    rows={3}
                    placeholder="We're building an accessible product and looking for a frontend engineer…"
                  />
                  <small>
                    Describe the opportunity and what a good contribution looks
                    like. Avoid confidential information.
                  </small>
                </label>
                <label className="discovery-field">
                  Skills to explore
                  <input
                    value={criteria.skills}
                    onChange={(event) =>
                      setCriteria({ ...criteria, skills: event.target.value })
                    }
                    maxLength={300}
                    placeholder="React, TypeScript, accessibility"
                  />
                  <small>
                    Separate skills with commas. Leave blank to explore
                    everyone.
                  </small>
                </label>
                <label className="discovery-field">
                  Already have someone in mind?
                  <input
                    value={criteria.query}
                    onChange={(event) =>
                      setCriteria({ ...criteria, query: event.target.value })
                    }
                    maxLength={200}
                    placeholder="Search a name or area of work"
                  />
                </label>
                {demo && (
                  <p className="discovery-muted">
                    Demo search matches skills and names. Opportunity context is
                    shown for exploration; it does not rank these sample
                    profiles.
                  </p>
                )}
                {error && (
                  <p role="alert" className="discovery-error">
                    {error}
                  </p>
                )}
                <button className="discovery-button" disabled={busy}>
                  {busy ? "Finding people…" : "Discover people"}
                  <ArrowRight size={18} aria-hidden="true" />
                </button>
              </form>
              <aside className="discovery-editorial">
                <span className="discovery-editorial-number">01 /</span>
                <h2>
                  A profile is
                  <br />a starting point.
                  <br />
                  <em>
                    Evidence opens
                    <br />
                    the conversation.
                  </em>
                </h2>
                <div className="discovery-editorial-rule" />
                <p>
                  Look at what someone made, how they contributed, and what a
                  mentor actually checked.
                </p>
                <p>No single score tells a person's whole story.</p>
                <span className="discovery-eyebrow">
                  Built in community. Seen in context.
                </span>
              </aside>
            </section>
          ) : (
            <section aria-label="Search results">
              <div className="discovery-results-bar">
                <div>
                  <span className="discovery-eyebrow">Explore people</span>
                  <h2>
                    {results.length}{" "}
                    {results.length === 1 ? "builder" : "builders"} to get to
                    know
                  </h2>
                  <p>
                    {appliedCriteria.skills || "All skills"}
                    {appliedCriteria.query ? ` · ${appliedCriteria.query}` : ""}
                  </p>
                </div>
                <button
                  className="discovery-button-secondary"
                  onClick={() => setStep("criteria")}
                >
                  <MagnifyingGlass size={17} aria-hidden="true" />
                  Edit criteria
                </button>
              </div>
              {appliedCriteria.context && (
                <p className="discovery-search-context">
                  <strong>Your opportunity</strong> {appliedCriteria.context}
                </p>
              )}
              <p className="discovery-muted">
                Explore source evidence and individual contributions. This list
                is not an overall ranking of people.
              </p>
              <div className="discovery-results">
                {results.map((profile, index) => (
                  <article className="discovery-person" key={profile.id}>
                    <div className="discovery-person-top">
                      <span className="discovery-person-index">
                        {String(index + 1).padStart(2, "0")}
                      </span>
                      <div className="discovery-avatar" aria-hidden="true">
                        {profile.name
                          .split(" ")
                          .map((part) => part[0])
                          .slice(0, 2)
                          .join("")}
                      </div>
                    </div>
                    <h3>{profile.name}</h3>
                    <p className="discovery-person-headline">
                      {profile.headline}
                    </p>
                    <p className="discovery-muted">{profile.location}</p>
                    <div className="discovery-tags">
                      {profile.skills.map((skill) => (
                        <span key={skill}>{skill}</span>
                      ))}
                    </div>
                    <div className="discovery-person-evidence">
                      <span>
                        {
                          profile.claims.flatMap((claim) => claim.evidence)
                            .length
                        }{" "}
                        sources attached
                      </span>
                      <span>
                        {
                          profile.claims.filter((claim) => claim.confirmation)
                            .length
                        }{" "}
                        mentor-confirmed entries
                      </span>
                    </div>
                    <button
                      className="discovery-text-button"
                      onClick={() => {
                        setSelected(profile);
                        window.scrollTo({ top: 0 });
                      }}
                    >
                      Explore {profile.name.split(" ")[0]}'s work
                      <ArrowUpRight size={19} aria-hidden="true" />
                    </button>
                  </article>
                ))}
              </div>
              {results.length === 0 && (
                <div className="discovery-empty">
                  <h3>No profiles match those filters yet.</h3>
                  <p>
                    Try fewer skills or a broader name search. Missing a match
                    says nothing about someone's potential.
                  </p>
                  <button
                    className="discovery-button-secondary"
                    onClick={() => setStep("criteria")}
                  >
                    Adjust your search
                  </button>
                </div>
              )}
            </section>
          )}
        </>
      )}
    </DiscoveryShell>
  );
}
