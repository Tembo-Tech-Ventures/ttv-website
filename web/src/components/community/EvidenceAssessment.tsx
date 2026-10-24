import React, { useRef, useState } from "react";
import type { FormEvent } from "react";
import { evidenceHref, type CommunityProfile } from "../discovery/types";
import { displayUiError } from "../discovery/ui-errors";
import {
  assessmentRubricSchema,
  assessmentSource,
  type AssessmentRubric,
  type EvidenceAssessment as Assessment,
} from "./assessment-contract";

export type AssessEvidence = (
  profile: CommunityProfile,
  rubric: AssessmentRubric,
) => Promise<Assessment>;

export function AssessmentResults({
  assessment,
  profile,
}: {
  assessment: Assessment;
  profile: CommunityProfile;
}) {
  if (assessment.status !== "completed")
    return (
      <output className="discovery-notice">
        <h4>
          {assessment.status === "unavailable"
            ? "Assessment service unavailable"
            : "Assessment response could not be validated"}
        </h4>
        <p>
          No evidence ratings were produced. This is a service issue, not a
          judgment about this person's work. You can try again later.
        </p>
      </output>
    );
  return (
    <div
      className="discovery-assessment-results"
      aria-label="Evidence assessment results"
    >
      <p className="discovery-eyebrow">
        {assessment.model
          ? "AI-generated evidence support"
          : "Evidence availability"}
      </p>
      {!assessment.model && (
        <p>No published evidence was available. No AI assessment was run.</p>
      )}
      <p className="discovery-muted">
        Criteria revision {assessment.rubric.version} · Profile revision{" "}
        {assessment.subject.profileVersion}
      </p>
      {assessment.criteria.map((criterion) => (
        <section key={criterion.criterionId}>
          <h4>{criterion.label}</h4>
          <p className="discovery-assessment-status">
            {criterion.status === "assessed"
              ? `Evidence support ${criterion.rating}/5`
              : criterion.status === "insufficient"
                ? "Insufficient evidence · Not scored"
                : criterion.status === "uncertain"
                  ? "Uncertain evidence · Not scored"
                  : "Contradictory evidence · Not scored"}
          </p>
          <p>{criterion.explanation}</p>
          {criterion.citations.length > 0 && (
            <ul aria-label={`Sources for ${criterion.label}`}>
              {criterion.citations.map((citation) => {
                const source = assessmentSource(profile, citation);
                return (
                  <li
                    key={`${citation.kind}:${citation.id}:${citation.version}`}
                  >
                    <span>
                      {source?.label ??
                        "Source no longer matches this profile. Refresh before using this assessment."}
                    </span>
                    {citation.quote && (
                      <blockquote>{citation.quote}</blockquote>
                    )}
                    {source?.sources.map((link) => {
                      const href = evidenceHref(link.url);
                      return href ? (
                        <a
                          key={link.id}
                          href={href}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          {link.title}
                        </a>
                      ) : null;
                    })}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      ))}
      <p className="discovery-chat-note">
        Ratings describe support in the documented evidence, not ability,
        verification or a hiring recommendation. Check sources and discuss gaps
        with the person.
      </p>
      {assessment.model && (
        <p className="discovery-muted">Model: {assessment.model}</p>
      )}
    </div>
  );
}

export default function EvidenceAssessment({
  profile,
  onAssess,
}: {
  profile: CommunityProfile;
  onAssess: AssessEvidence;
}) {
  const [rows, setRows] = useState([
    { id: "criterion-1", label: "", terms: "" },
  ]);
  const nextId = useRef(2);
  const [revision, setRevision] = useState(1);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  function edit(next: typeof rows) {
    setRows(next);
    setRevision((value) => value + 1);
    setAssessment(null);
    setError("");
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (pending.current) return;
    const rubric = assessmentRubricSchema.safeParse({
      id: "institution-ui",
      version: revision,
      criteria: rows.map((row) => ({
        id: row.id,
        label: row.label,
        terms: row.terms
          .split(",")
          .map((term) => term.trim())
          .filter(Boolean),
        contraryTerms: [],
      })),
    });
    if (!rubric.success) {
      setError(
        "Add a label and 1–10 supporting terms for each criterion. Terms must be 2–80 characters each.",
      );
      return;
    }
    pending.current = true;
    setBusy(true);
    setError("");
    setAssessment(null);
    try {
      setAssessment(await onAssess(profile, rubric.data));
    } catch (cause) {
      setError(
        displayUiError(
          cause,
          "The assessment could not be completed. Your criteria are still here; try again later.",
        ),
      );
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <section
      className="discovery-assessment"
      aria-label="Assess documented evidence"
    >
      <h3>Assess evidence against your criteria</h3>
      <p id="assessment-help">
        Define what you want to understand about this person's work. These
        criteria are separate from search filters. Ratings describe evidence
        support, not ability.
      </p>
      <details className="discovery-assessment-scale">
        <summary>What the 1–5 scale means</summary>
        <ol>
          <li>Minimal but relevant specific claim.</li>
          <li>Partial concrete account with important gaps.</li>
          <li>Detailed direct contribution tied to the criterion.</li>
          <li>Detailed support with consistent independent corroboration.</li>
          <li>
            Unusually complete, attributable support with corroboration and
            clear limitations.
          </li>
        </ol>
        <p>
          Missing, uncertain or conflicting evidence is not scored. A mentor
          title or the number of entries does not automatically increase a
          rating.
        </p>
      </details>
      <form
        onSubmit={submit}
        aria-describedby="assessment-help"
        aria-busy={busy}
      >
        <fieldset disabled={busy}>
          <legend className="discovery-eyebrow">
            Your assessment criteria
          </legend>
          {rows.map((row, index) => (
            <div key={row.id} className="discovery-assessment-criterion">
              <label htmlFor={`${row.id}-label`}>Criterion {index + 1}</label>
              <input
                id={`${row.id}-label`}
                value={row.label}
                required
                maxLength={200}
                placeholder="For example, accessible interface design"
                onChange={(event) =>
                  edit(
                    rows.map((item) =>
                      item.id === row.id
                        ? { ...item, label: event.target.value }
                        : item,
                    ),
                  )
                }
              />
              <label htmlFor={`${row.id}-terms`}>
                Supporting terms {index + 1}
              </label>
              <input
                id={`${row.id}-terms`}
                value={row.terms}
                required
                maxLength={818}
                placeholder="keyboard navigation, accessibility"
                aria-describedby="assessment-terms-help"
                onChange={(event) =>
                  edit(
                    rows.map((item) =>
                      item.id === row.id
                        ? { ...item, terms: event.target.value }
                        : item,
                    ),
                  )
                }
              />
              {rows.length > 1 && (
                <button
                  type="button"
                  className="discovery-button discovery-button-secondary"
                  onClick={() =>
                    edit(rows.filter((item) => item.id !== row.id))
                  }
                >
                  Remove criterion {index + 1}
                </button>
              )}
            </div>
          ))}
          <p id="assessment-terms-help" className="discovery-muted">
            Separate 1–10 terms with commas. Use 2–80 characters per term. You
            can assess up to 10 criteria.
          </p>
          {rows.length < 10 && (
            <button
              type="button"
              className="discovery-button discovery-button-secondary"
              onClick={() =>
                edit([
                  ...rows,
                  { id: `criterion-${nextId.current++}`, label: "", terms: "" },
                ])
              }
            >
              Add criterion
            </button>
          )}
          <button className="discovery-button" type="submit">
            {busy ? "Assessing evidence…" : "Assess evidence"}
          </button>
        </fieldset>
      </form>
      {error && (
        <p role="alert" className="discovery-error">
          {error}
        </p>
      )}
      <div aria-live="polite">
        {assessment && (
          <AssessmentResults assessment={assessment} profile={profile} />
        )}
      </div>
    </section>
  );
}
