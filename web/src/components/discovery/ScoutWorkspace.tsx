import React, { useRef, useState } from "react";
import type { FormEvent } from "react";
import {
  ArrowLeft,
  ArrowUpRight,
  ArrowRight,
  MagnifyingGlass,
  Link as LinkIcon,
} from "@phosphor-icons/react";
import EvidenceAssessment, {
  type AssessEvidence,
} from "../community/EvidenceAssessment";
import DiscoveryShell from "./DiscoveryShell";
import ClaimConfirmations from "./ClaimConfirmations";
import { displayUiError } from "./ui-errors";
import {
  evidenceHref,
  filterDemoProfiles,
  currentConfirmations,
} from "./types";
import type {
  CommunityProfile,
  EvidenceAnswer,
  EvidenceOrder,
  EvidenceSource,
  ScoutCriteria,
} from "./types";

interface Props {
  profiles: CommunityProfile[];
  initialProfile?: CommunityProfile | null;
  demo?: boolean;
  onAssess?: AssessEvidence;
  onOrder?: (criteria: ScoutCriteria) => Promise<EvidenceOrder>;
  onSearch?: (criteria: ScoutCriteria) => Promise<CommunityProfile[]>;
  onOpenProfile?: (profileId: string) => Promise<CommunityProfile>;
  onAsk?: (
    profile: CommunityProfile,
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
  onAssess,
}: {
  profile: CommunityProfile;
  criteria: ScoutCriteria;
  demo: boolean;
  onAsk?: Props["onAsk"];
  onAssess?: AssessEvidence;
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
      if (onAsk) setAnswer(await onAsk(profile, question.trim(), criteria));
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
        displayUiError(
          cause,
          "We could not answer that question. Please try again.",
        ),
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
        </div>
        <h1>{profile.name}</h1>
        <p className="discovery-profile-headline">{profile.headline}</p>
        <p className="discovery-muted">{profile.location}</p>
        <p className="discovery-about">{profile.about}</p>
        <div className="discovery-goal">
          <strong>Opportunity goals</strong>
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
              <ClaimConfirmations claim={claim} />
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
        {onAssess && (
          <EvidenceAssessment profile={profile} onAssess={onAssess} />
        )}
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
            {answer.limited && (
              <p className="discovery-notice">
                The available evidence or response was limited. Narrow your
                question before drawing conclusions.
              </p>
            )}
            {answer.references && answer.references.length > 0 && (
              <ul aria-label="Cited community evidence">
                {answer.references.map((reference) => (
                  <li key={reference}>{reference}</li>
                ))}
              </ul>
            )}
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

function ProfileLink({
  profileId,
  demo,
}: {
  profileId: string;
  demo: boolean;
}) {
  if (demo) return null;
  return (
    <p className="discovery-muted">
      <a href={`/dashboard/discover?profile=${encodeURIComponent(profileId)}`}>
        Open profile link
      </a>
      {" · Requires approved institutional access"}
    </p>
  );
}

export function EvidenceOrdering({enabled,count,ordering,order,onOrder}:{enabled:boolean;count:number;ordering:boolean;order:EvidenceOrder|null;onOrder:()=>void}) {
  if(!enabled || count===0) return null;
  return (<section className="discovery-answer" aria-label="Order by published evidence">
                <h2>Which work fits your opportunity?</h2>
                <p>Compare a small retrieved shortlist using published project evidence. Missing evidence stays unknown; people make the hiring decision.</p>
                <button type="button" className="discovery-button" disabled={ordering} onClick={onOrder}>{ordering ? "Comparing published evidence…" : "Order by published evidence"}</button>
                {order && <div aria-live="polite">
                  <p>AI-generated evidence order · {order.evaluatedCandidates} profiles returned by search; detailed evidence was read for the listed shortlist. This is a subset, not a ranking of all members or ability.</p>
                  <ol>{order.profiles.map(p=><li key={p.userId}>
                    <h3><a href={`/dashboard/discover?profile=${encodeURIComponent(p.userId)}`}>{p.name}</a></h3>
                    <p>{p.reason}</p>
                    <ul aria-label={`Cited evidence for ${p.name}`}>{(p.citations??[]).map(c=><li key={c.id}>{evidenceHref(c.url ?? "") ? <a href={evidenceHref(c.url ?? "")!} target="_blank" rel="noopener noreferrer">{c.kind === "confirmation" ? "Mentor statement" : "Published contribution"} · Revision {c.version}</a> : <span>{c.kind === "confirmation" ? "Mentor statement" : "Published contribution"} · Revision {c.version} · Source link unavailable</span>}</li>)}</ul>
                    <p>Missing evidence: {p.missingEvidence.length > 0 ? p.missingEvidence.join("; ") : "Review the cited work and discuss remaining questions."}</p>
                  </li>)}</ol>
                  <p>{order.text}</p>
                </div>}
              </section>);
}

export default function ScoutWorkspace({
  profiles,
  initialProfile = null,
  demo = false,
  onSearch,
  onOrder,
  onAsk,
  onOpenProfile,
  onAssess,
}: Props) {
  const [criteria, setCriteria] = useState<ScoutCriteria>({
    context: "",
    skills: "",
    query: "",
  });
  const [evidenceOrder,setEvidenceOrder]=useState<EvidenceOrder|null>(null);
  const [ordering,setOrdering]=useState(false);
  const orderingRef=useRef(false);
  const [lookup, setLookup] = useState(false);
  const modeText = lookup
    ? {
        step: "Look up a person",
        title: "Whose work would you like to explore?",
        action: "Look up person",
      }
    : {
        step: "Define what matters",
        title: "Who would move your work forward?",
        action: "Discover people",
      };
  const [lookupName, setLookupName] = useState("");
  const [results, setResults] = useState(profiles);
  const [selected, setSelected] = useState<CommunityProfile | null>(
    initialProfile,
  );
  const [step, setStep] = useState<"criteria" | "results">("criteria");
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const openingRef = useRef(false);
  const searching = useRef(false);
  const [error, setError] = useState("");
  const [appliedCriteria, setAppliedCriteria] = useState(criteria);
  async function openProfile(profile: CommunityProfile) {
    if (openingRef.current) return;
    openingRef.current = true;
    setOpening(profile.id);
    setError("");
    try {
      setSelected(onOpenProfile ? await onOpenProfile(profile.id) : profile);
      window.scrollTo({ top: 0 });
    } catch (cause) {
      setError(
        displayUiError(
          cause,
          "The profile could not be loaded. Please try again.",
        ),
      );
    } finally {
      setOpening(null);
      openingRef.current = false;
    }
  }
  async function search(event: FormEvent) {
    event.preventDefault();
    if (searching.current || orderingRef.current) return;
    setEvidenceOrder(null);
    const searchCriteria = lookup
      ? { context: "", skills: "", query: lookupName.trim() }
      : criteria;
    if (lookup && !searchCriteria.query) return;
    if (
      searchCriteria.skills.split(",").filter((skill) => skill.trim()).length >
      10
    ) {
      setError("Explore up to 10 skills at a time.");
      return;
    }
    searching.current = true;
    setBusy(true);
    setError("");
    try {
      if (onSearch) setResults(await onSearch(searchCriteria));
      else if (demo) setResults(filterDemoProfiles(profiles, searchCriteria));
      else
        throw new Error(
          "Search is unavailable right now. Your criteria are saved in this form; please try again.",
        );
      setAppliedCriteria({ ...searchCriteria });
      setStep("results");
    } catch (cause) {
      setError(
        displayUiError(
          cause,
          "Search could not be completed. Your criteria are still here; please try again.",
        ),
      );
    } finally {
      setBusy(false);
      searching.current = false;
    }
  }
  const controlsDisabled = busy || ordering || opening !== null;
  async function orderEvidence() {
    if(!onOrder || orderingRef.current) return;
    orderingRef.current=true;setOrdering(true);setError("");setEvidenceOrder(null);
    try {setEvidenceOrder(await onOrder(appliedCriteria));}
    catch(cause){setError(displayUiError(cause,"Evidence ordering could not be completed. Review the published profiles or try a narrower opportunity."));}
    finally{orderingRef.current=false;setOrdering(false);}
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
          <ProfileLink profileId={selected.id} demo={demo} />
          <ProfileEvidence
            key={selected.id}
            profile={selected}
            criteria={appliedCriteria}
            demo={demo}
            onAsk={onAsk}
            onAssess={onAssess}
          />
        </>
      ) : (
        <>
          <div className="discovery-page-heading">
            <div>
              <h1>
                Find the person.
                <br />
                <em>See the work.</em>
              </h1>
            </div>
            <p>
              Find community builders through their work.
            </p>
          </div>
          <div className="discovery-actions">
            <button
              type="button"
              className="discovery-text-button"
              aria-pressed={!lookup}
              disabled={controlsDisabled}
              onClick={() => {
                setLookup(false);
                setStep("criteria");
                setError("");
              }}
            >
              Scout by criteria
            </button>
            <button
              type="button"
              className="discovery-text-button"
              aria-pressed={lookup}
              disabled={controlsDisabled}
              onClick={() => {
                setLookup(true);
                setStep("criteria");
                setError("");
              }}
            >
              Find someone you know
            </button>
          </div>
          <ol className="discovery-steps" aria-label="Scouting steps">
            <li aria-current={step === "criteria" ? "step" : undefined}>
              <span>01</span>
              {modeText.step}
            </li>
            <li aria-current={step === "results" ? "step" : undefined}>
              <span>02</span>Explore the evidence
            </li>
          </ol>
          {step === "criteria" ? (
            <section className="discovery-criteria-grid">
              <form className="discovery-criteria" onSubmit={search}>
                <h2>{modeText.title}</h2>
                {lookup ? (
                  <label className="discovery-field">
                    Name to look up
                    <input
                      value={lookupName}
                      onChange={(event) => setLookupName(event.target.value)}
                      maxLength={200}
                      required
                      placeholder="Enter their name"
                    />
                    <small>
                      Search eligible talent without your scouting skills or
                      opportunity criteria. Mentor and administrator profiles
                      may not appear here; use a direct profile link if you have
                      one.
                    </small>
                  </label>
                ) : (
                  <>
                    <label className="discovery-field">
                      What are you working on?
                      <textarea
                        value={criteria.context}
                        onChange={(event) =>
                          setCriteria({
                            ...criteria,
                            context: event.target.value,
                          })
                        }
                        maxLength={4000}
                        rows={3}
                        placeholder="We're building an accessible product and looking for a frontend engineer…"
                      />
                      <small>
                        Describe the opportunity and what a good contribution
                        looks like. Avoid confidential information.
                      </small>
                    </label>
                    <label className="discovery-field">
                      Skills to explore
                      <input
                        value={criteria.skills}
                        onChange={(event) =>
                          setCriteria({
                            ...criteria,
                            skills: event.target.value,
                          })
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
                          setCriteria({
                            ...criteria,
                            query: event.target.value,
                          })
                        }
                        maxLength={200}
                        placeholder="Search a name or area of work"
                      />
                    </label>
                  </>
                )}
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
                  {busy ? "Finding people…" : modeText.action}
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
              </aside>
            </section>
          ) : (
            <section aria-label="Search results">
              <EvidenceOrdering enabled={Boolean(onOrder)} count={results.length} ordering={ordering} order={evidenceOrder} onOrder={orderEvidence} />
              {error && (
                <p role="alert" className="discovery-error">
                  {error}
                </p>
              )}
              <div className="discovery-results-bar">
                <div>
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
                      {profile.evidenceLoaded === false ? (
                        <span>
                          Open this profile to inspect its sources and
                          confirmations.
                        </span>
                      ) : (
                        <>
                          <span>
                            {
                              profile.claims.flatMap((claim) => claim.evidence)
                                .length
                            }{" "}
                            sources attached
                          </span>
                          <span>
                            {
                              profile.claims.filter(
                                (claim) =>
                                  currentConfirmations(claim).length > 0,
                              ).length
                            }{" "}
                            confirmed entries
                          </span>
                        </>
                      )}
                    </div>
                    <button
                      className="discovery-text-button"
                      disabled={opening !== null}
                      onClick={() => void openProfile(profile)}
                    >
                      {opening === profile.id
                        ? "Opening profile…"
                        : `Explore ${profile.name.split(" ")[0]}'s work`}
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
