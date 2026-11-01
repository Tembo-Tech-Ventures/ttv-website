import React, { useContext, useEffect, useId, useRef, useState } from "react";
import { awaitingConfirmationText } from "@/components/platform/spaces/awaiting-confirmation";
import ClaimConfirmations from "../discovery/ClaimConfirmations";
import { CommunityEmbedded } from "../discovery/DiscoveryShell";
import type { ClaimConfirmation } from "../discovery/types";
import { UiApiError, displayUiError } from "../discovery/ui-errors";

export interface MentorReviewRequest {
  id: string;
  version: number;
  memberName: string;
  claimTitle: string;
  claimDescription: string;
  evidence: { id: string; title: string; url: string }[];
  confirmations?: ClaimConfirmation[];
  // Form availability, not a claim that this contribution has never been reviewed.
  status: "pending" | "confirmed" | "declined";
  /** This mentor set this revision aside ("I can't confirm this"); only they ever see it. */
  setAside?: boolean;
}

export interface MentorReviewDecision {
  decision: "confirmed" | "declined";
  note: string;
  method: string;
  expectedRevision: number;
}

export interface MentorReviewProps {
  requests: MentorReviewRequest[];
  onReview: (id: string, review: MentorReviewDecision) => Promise<void>;
  /**
   * Private set-aside and its undo. Given only on the spaces Confirm page,
   * where work counts as waiting; without them the action is not offered.
   */
  onSetAside?: (id: string, expectedRevision: number) => Promise<void>;
  onUndoSetAside?: (id: string) => Promise<void>;
  demo?: boolean;
  allowDecline?: boolean;
}

const revisionKey = (request: MentorReviewRequest) => `${request.id}:${request.version}`;

export function validateMentorNote(note: string): string | null {
  const text = note.trim();
  if (text.length < 20 || text.split(/\s+/u).length < 3) {
    return "Describe what you personally checked in at least 20 characters and three words.";
  }
  if (text.length > 2000)
    return "Keep your review note within 2,000 characters.";
  return null;
}

export function validateMentorMethod(method: string): string | null {
  const length = method.trim().length;
  return length < 3 || length > 500
    ? "Describe how you checked the claim in 3 to 500 characters."
    : null;
}

/**
 * Where an evidence link goes, short enough to read: "github.com/achieng/ledger".
 * Members often leave the default title ("Supporting work"), so the address is
 * what tells one link from the next. The host is always shown whole, so a long
 * look-alike ("github.com.evil.example") can never pass for the real site; only
 * the path is shortened.
 */
export function evidenceDestination(href: string, max = 48): string {
  const url = new URL(href);
  const host = url.hostname.replace(/^www\./, "");
  const path = url.pathname.replace(/\/$/, "");
  const room = Math.max(0, max - host.length);
  return path.length <= room ? host + path : `${host}${path.slice(0, Math.max(0, room - 1))}…`;
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
  onSetAside,
  demo,
  allowDecline,
}: {
  request: MentorReviewRequest;
  onReview: MentorReviewProps["onReview"];
  onSetAside?: (request: MentorReviewRequest) => Promise<void>;
  demo: boolean;
  allowDecline: boolean;
}) {
  const id = useId();
  const embedded = useContext(CommunityEmbedded);
  const [note, setNote] = useState("");
  const [method, setMethod] = useState("");
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
    const validation = validateMentorNote(note) ?? validateMentorMethod(method);
    if (validation || !decision || (decision === "declined" && !allowDecline)) {
      setError(validation ?? "Choose a review decision.");
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await onReview(request.id, {
        decision,
        note: note.trim(),
        method: method.trim(),
        expectedRevision: request.version,
      });
      setSaved(decision);
    } catch (failure) {
      setError(
        failure instanceof UiApiError && failure.status === 409
          ? "This claim changed since you opened it. Refresh the claim and review its latest evidence before confirming. Your note is still here."
          : displayUiError(
              failure,
              "Your review could not be saved. Your note is still here; please try again.",
            ),
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
      <p>Claim revision {request.version}</p>
      <p>{request.claimDescription}</p>
      <h4>Evidence for this claim</h4>
      {request.evidence.length > 0 ? (
        <ul className="mentor-evidence">
          {request.evidence.map((item) => {
            const href = safeMentorEvidenceUrl(item.url);
            return (
              <li key={item.id}>
                {href ? (
                  <a href={href} target="_blank" rel="noopener noreferrer">
                    <span className="mentor-evidence__title">{item.title}</span>{" "}
                    <span className="mentor-evidence__place">{evidenceDestination(href)}</span>
                    <span aria-hidden="true"> ↗</span>
                    <span className="sr-only"> (opens in a new tab)</span>
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
      {(request.confirmations?.length ?? 0) > 0 && (
        <section aria-label="Recorded confirmations">
          <h4>Confirmation history</h4>
          <ClaimConfirmations
            claim={{
              version: request.version,
              confirmations: request.confirmations ?? [],
            }}
          />
        </section>
      )}
      <output>
        {status === "pending"
          ? embedded
            ? "Waiting for your confirmation of this revision."
            : "You can add a confirmation after reviewing this revision."
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
                {allowDecline && (
                  <option value="declined">Decline confirmation</option>
                )}
              </select>
            </label>
            <label className="discovery-field" htmlFor={`${id}-method`}>
              How did you check it?
              <input
                id={`${id}-method`}
                value={method}
                onChange={(event) => setMethod(event.target.value)}
                required
                minLength={3}
                maxLength={500}
                aria-describedby={error ? `${id}-error` : undefined}
              />
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
      <SetAsideAction
        request={request}
        waiting={status === "pending"}
        titleId={`${id}-title`}
        disabled={busy}
        onSetAside={onSetAside}
      />
    </article>
  );
}

/** "I can't confirm this", for one contribution waiting for this mentor, when offered. */
function SetAsideAction({
  request,
  waiting,
  titleId,
  disabled,
  onSetAside,
}: {
  request: MentorReviewRequest;
  waiting: boolean;
  titleId: string;
  disabled: boolean;
  onSetAside?: (request: MentorReviewRequest) => Promise<void>;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!waiting || !onSetAside) return null;
  const offer = onSetAside;
  async function setAside() {
    setBusy(true);
    setError(null);
    try {
      // On success the parent moves this contribution to the set-aside list.
      await offer(request);
    } catch (failure) {
      setError(
        failure instanceof UiApiError && failure.status === 409
          ? "This contribution changed since you opened it. Refresh contributions to see its latest revision."
          : displayUiError(failure, "This could not be set aside. Please try again."),
      );
      setBusy(false);
    }
  }
  return (
    <div className="mentor-set-aside-action">
      <button
        className="discovery-button-secondary"
        type="button"
        onClick={() => void setAside()}
        disabled={disabled || busy}
        aria-describedby={`${titleId} ${id}-help`}
      >
        Set aside: I can&apos;t confirm this
      </button>
      <p id={`${id}-help`}>
        Only you see this. It leaves your waiting list, and the member
        isn&apos;t told.
      </p>
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

function UndoSetAside({
  request,
  onUndo,
}: {
  request: MentorReviewRequest;
  onUndo: (request: MentorReviewRequest) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function undo() {
    setBusy(true);
    setError(null);
    try {
      await onUndo(request);
    } catch (failure) {
      setError(displayUiError(failure, "This could not be undone. Please try again."));
      setBusy(false);
    }
  }
  return (
    <>
      <button
        className="discovery-button-secondary"
        type="button"
        onClick={() => void undo()}
        disabled={busy}
        aria-label={`Undo: put ${request.claimTitle} back in your waiting list`}
      >
        Undo
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}

export default function MentorReview({
  requests,
  onReview,
  onSetAside,
  onUndoSetAside,
  demo = false,
  allowDecline = false,
}: MentorReviewProps) {
  const id = useId();
  // In the spaces shell the Mentoring space counts these as waiting, so the
  // page says the same; the existing dashboard keeps its wording.
  const embedded = useContext(CommunityEmbedded);
  const canSetAside = Boolean(onSetAside && onUndoSetAside);
  const [reviewed, setReviewed] = useState<ReadonlySet<string>>(() => new Set());
  const [setAside, setSetAside] = useState<ReadonlySet<string>>(
    () => new Set(canSetAside ? requests.filter((request) => request.setAside).map(revisionKey) : []),
  );
  const [notice, setNotice] = useState<{ text: string; undo?: MentorReviewRequest } | null>(null);
  const noticeRef = useRef<HTMLOutputElement>(null);
  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);
  const listed = requests.filter((request) => !setAside.has(revisionKey(request)));
  const setAsideRequests = requests.filter((request) => setAside.has(revisionKey(request)));
  const waiting = listed.filter(
    (request) => request.status === "pending" && !reviewed.has(revisionKey(request)),
  ).length;
  async function review(requestId: string, decision: MentorReviewDecision) {
    await onReview(requestId, decision);
    setReviewed((current) => new Set(current).add(`${requestId}:${decision.expectedRevision}`));
  }
  async function setRequestAside(request: MentorReviewRequest) {
    await onSetAside?.(request.id, request.version);
    setSetAside((current) => new Set(current).add(revisionKey(request)));
    setNotice({ text: `You've set aside ${request.claimTitle}. The member isn't told.`, undo: request });
  }
  async function undoSetAside(request: MentorReviewRequest) {
    await onUndoSetAside?.(request.id);
    setSetAside((current) => {
      const next = new Set(current);
      next.delete(revisionKey(request));
      return next;
    });
    setNotice({ text: `${request.claimTitle} is back in your waiting list.` });
  }
  return (
    <section className="discovery-panel" aria-labelledby={`${id}-heading`}>
      <h2 id={`${id}-heading`}>Confirm what you have personally checked</h2>
      <p>
        Confirm only the named contribution and evidence you reviewed, not the
        whole person. An assistant response does not confirm a claim.
      </p>
      {embedded ? (
        <>
          <p>
            Members share these contributions so mentors can confirm the parts
            they have checked. Nobody has sent you a review request: confirm
            only work you have checked yourself. Some already have reviews from
            other mentors in their confirmation history.
          </p>
          {requests.length > 0 && (
            <p data-awaiting-confirmation={waiting}>
              <strong>
                {waiting > 0
                  ? awaitingConfirmationText(waiting)
                  : "Nothing here is waiting for your confirmation."}
              </strong>
            </p>
          )}
        </>
      ) : (
        <p>
          Published contributions may already have reviews. Check the confirmation
          history; this list is not a queue of review requests.
        </p>
      )}
      {demo && (
        <p className="discovery-demo-notice">
          Demo data · Reviews here are demonstration actions, not real mentor
          confirmations.
        </p>
      )}
      {canSetAside && (
        <div className="mentor-set-aside-notice">
          <output ref={noticeRef} tabIndex={-1}>
            {notice?.text}
          </output>
          {notice?.undo && setAside.has(revisionKey(notice.undo)) && (
            <UndoSetAside key={revisionKey(notice.undo)} request={notice.undo} onUndo={undoSetAside} />
          )}
        </div>
      )}
      {setAsideRequests.length > 0 && (
        <details className="mentor-set-aside">
          <summary>Set aside ({setAsideRequests.length})</summary>
          <p>
            Only you see this list. Setting work aside doesn&apos;t tell the
            member or change anything about their work. If they share a new
            revision, it comes back to your waiting list.
          </p>
          <ul>
            {setAsideRequests.map((request) => (
              <li key={revisionKey(request)}>
                <p className="discovery-eyebrow">{request.memberName}</p>
                <p>
                  <strong>{request.claimTitle}</strong> · Claim revision{" "}
                  {request.version}
                </p>
                <p>You&apos;ve set this aside. The member isn&apos;t told.</p>
                <UndoSetAside request={request} onUndo={undoSetAside} />
              </li>
            ))}
          </ul>
        </details>
      )}
      {requests.length === 0 ? (
        <p>No published contributions are available to review.</p>
      ) : (
        listed.map((request) => (
          <ReviewRequest
            key={revisionKey(request)}
            request={request}
            onReview={review}
            onSetAside={canSetAside ? setRequestAside : undefined}
            demo={demo}
            allowDecline={allowDecline}
          />
        ))
      )}
    </section>
  );
}
