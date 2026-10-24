import React, { useId, useRef, useState } from "react";

export interface MentorReviewRequest {
  id: string;
  memberName: string;
  claimTitle: string;
  claimDescription: string;
  evidence: { id: string; title: string; url: string }[];
  status: "pending" | "confirmed" | "declined";
}

export interface MentorReviewDecision {
  decision: "confirmed" | "declined";
  note: string;
}

export interface MentorReviewProps {
  requests: MentorReviewRequest[];
  onReview: (id: string, review: MentorReviewDecision) => Promise<void>;
  demo?: boolean;
}

export function validateMentorNote(note: string): string | null {
  const text = note.trim();
  if (text.length < 20 || text.split(/\s+/u).length < 3) {
    return "Describe what you personally checked in at least 20 characters and three words.";
  }
  if (text.length > 2000)
    return "Keep your review note within 2,000 characters.";
  return null;
}

export function safeMentorEvidenceUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}

function ReviewRequest({
  request,
  onReview,
  demo,
}: {
  request: MentorReviewRequest;
  onReview: MentorReviewProps["onReview"];
  demo: boolean;
}) {
  const id = useId();
  const [note, setNote] = useState("");
  const [decision, setDecision] = useState<
    MentorReviewDecision["decision"] | ""
  >("");
  const [saved, setSaved] = useState<MentorReviewDecision["decision"] | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const status = saved ?? request.status;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || status !== "pending") return;
    const validation = validateMentorNote(note);
    if (validation || !decision) {
      setError(validation ?? "Choose a review decision.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await onReview(request.id, { decision, note: note.trim() });
      setSaved(decision);
    } catch {
      setError(
        "Your review could not be saved. Your note is still here; please try again.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <article className="discovery-panel" aria-labelledby={`${id}-title`}>
      <p className="discovery-eyebrow">{request.memberName}</p>
      <h3 id={`${id}-title`}>{request.claimTitle}</h3>
      <p>{request.claimDescription}</p>
      <h4>Evidence for this claim</h4>
      {request.evidence.length > 0 ? (
        <ul>
          {request.evidence.map((item) => {
            const href = safeMentorEvidenceUrl(item.url);
            return (
              <li key={item.id}>
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    {item.title} (opens in a new tab)
                  </a>
                ) : (
                  <span>{item.title} — link unavailable</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : (
        <p>
          No evidence links supplied. Missing evidence is not evidence against
          the member.
        </p>
      )}
      <output>
        {status === "pending"
          ? "Awaiting your review"
          : status === "confirmed"
            ? `${demo ? "Demo: " : ""}Claim confirmed: ${request.claimTitle}`
            : `${demo ? "Demo: " : ""}Confirmation declined for this claim: ${request.claimTitle}`}
      </output>
      {status === "pending" && (
        <form onSubmit={submit} aria-busy={busy}>
          <fieldset disabled={busy}>
            <legend>Your review of this claim</legend>
            <label className="discovery-field" htmlFor={`${id}-decision`}>
              Decision
              <select
                id={`${id}-decision`}
                value={decision}
                required
                onChange={(event) => {
                  const value = event.target.value;
                  setDecision(
                    value === "confirmed" || value === "declined" ? value : "",
                  );
                }}
              >
                <option value="">Choose a decision</option>
                <option value="confirmed">Confirm this claim</option>
                <option value="declined">Decline confirmation</option>
              </select>
            </label>
            <label className="discovery-field" htmlFor={`${id}-note`}>
              What did you personally check?
              <textarea
                id={`${id}-note`}
                value={note}
                onChange={(event) => setNote(event.target.value)}
                required
                minLength={20}
                maxLength={2000}
                rows={5}
                aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
              />
            </label>
            <p id={`${id}-help`}>
              Name the evidence or work you checked, what it supports, and any
              limits. Use at least 20 characters and three words. Do not include
              private or sensitive details.
            </p>
            <button className="discovery-button" type="submit">
              {busy
                ? "Saving review…"
                : demo
                  ? "Save demo review"
                  : "Save review"}
            </button>
          </fieldset>
          {error && (
            <p id={`${id}-error`} role="alert">
              {error}
            </p>
          )}
        </form>
      )}
    </article>
  );
}

export default function MentorReview({
  requests,
  onReview,
  demo = false,
}: MentorReviewProps) {
  const id = useId();
  return (
    <section className="discovery-panel" aria-labelledby={`${id}-heading`}>
      <p className="discovery-eyebrow">Mentor review</p>
      <h2 id={`${id}-heading`}>Confirm what you have personally checked</h2>
      <p>
        Your confirmation applies only to the named claim and the evidence you
        reviewed. It is not an endorsement of the whole person. An assistant
        response does not confirm a claim.
      </p>
      {demo && (
        <p className="discovery-demo-notice">
          Demo data · Reviews here are demonstration actions, not real mentor
          confirmations.
        </p>
      )}
      {requests.length === 0 ? (
        <p>No claims are awaiting review.</p>
      ) : (
        requests.map((request) => (
          <ReviewRequest
            key={request.id}
            request={request}
            onReview={onReview}
            demo={demo}
          />
        ))
      )}
    </section>
  );
}
