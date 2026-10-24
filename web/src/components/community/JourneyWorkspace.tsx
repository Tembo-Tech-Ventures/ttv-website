import React, { useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, Plus } from "@phosphor-icons/react";
import DiscoveryShell from "../discovery/DiscoveryShell";
import { EvidenceLinks } from "../discovery/ScoutWorkspace";

import type { CommunityProfile, JourneyClaim } from "../discovery/types";
import ClaimConfirmations from "../discovery/ClaimConfirmations";
import { displayUiError } from "../discovery/ui-errors";
import ProfileEditor, { type EditableCommunityProfile } from "./ProfileEditor";

export interface ClaimDraft {
  title: string;
  description: string;
  date: string;
  sourceUrl: string;
}
export function validateClaimDraft(draft: ClaimDraft): string | null {
  if (draft.title.length > 160) return "Keep the title within 160 characters.";
  if (draft.description.length > 6000)
    return "Keep the contribution within 6,000 characters.";
  if (draft.title.trim().length < 3)
    return "Give this entry a title of at least 3 characters.";
  if (draft.description.trim().length < 20)
    return "Describe your contribution in at least 20 characters.";
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(draft.date) ||
    Number.isNaN(Date.parse(draft.date)) ||
    new Date(draft.date).toISOString().slice(0, 10) !== draft.date
  )
    return "Choose a date for this contribution.";
  if (draft.sourceUrl.trim()) {
    try {
      const url = new URL(draft.sourceUrl.trim());
      if (
        url.protocol !== "https:" ||
        url.username ||
        url.password ||
        /^\/(admin|api|dashboard)(?:\/|$)/i.test(url.pathname)
      )
        return "Use a public HTTPS link without credentials or private application paths.";
    } catch {
      return "Use a complete public HTTPS link for your source.";
    }
  }
  return null;
}

export default function JourneyWorkspace({
  profile: initialProfile,
  demo = false,
  onSave,
  onSaveProfile,
}: {
  profile: CommunityProfile;
  demo?: boolean;
  onSave?: (draft: ClaimDraft) => Promise<JourneyClaim>;
  onSaveProfile?: (
    draft: EditableCommunityProfile,
  ) => Promise<CommunityProfile>;
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [claims, setClaims] = useState(initialProfile.claims);
  const [editingProfile, setEditingProfile] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<ClaimDraft>({
    title: "",
    description: "",
    date: "",
    sourceUrl: "",
  });
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const change = (key: keyof ClaimDraft, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    const problem = validateClaimDraft(draft);
    if (problem) {
      setError(problem);
      return;
    }
    saving.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      let claim: JourneyClaim;
      if (onSave) claim = await onSave(draft);
      else if (demo)
        claim = {
          id: `demo-${crypto.randomUUID()}`,
          version: 1,
          visibility: "institution",
          confirmations: [],
          title: draft.title.trim(),
          description: draft.description.trim(),
          date: draft.date,
          skills: [],
          evidence: draft.sourceUrl.trim()
            ? [
                {
                  id: `demo-source-${crypto.randomUUID()}`,
                  title: "Supporting work",
                  url: draft.sourceUrl.trim(),
                  kind: "Member source",
                },
              ]
            : [],
        };
      else
        throw new Error(
          "We could not save your entry right now. Your draft is still here; try again shortly.",
        );
      setClaims((current) => [claim, ...current]);
      setEditing(false);
      setDraft({
        title: "",
        description: "",
        date: "",
        sourceUrl: "",
      });
      setNotice(
        demo
          ? "Demo entry added to this page. It will reset when you reload."
          : "Your contribution has been saved.",
      );
    } catch (cause) {
      setError(
        displayUiError(
          cause,
          "We could not save your contribution. Your draft is still here.",
        ),
      );
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }
  return (
    <DiscoveryShell active="journey" demo={demo}>
      <div className="discovery-page-heading">
        <div>
          <span className="discovery-eyebrow">
            Your community profile / journey
          </span>
          <h1>
            Your work.
            <br />
            <em>Your story.</em>
          </h1>
        </div>
        <p>
          Small contributions add up.
          <br />
          Show what you made, what you learned,
          <br />
          and the part that was yours.
        </p>
      </div>
      <div className="discovery-member-grid">
        <section>
          <div className="discovery-visibility">
            <strong>Who can discover this?</strong>
            <p>
              Your profile and journey contributions help approved institutions
              discover community members for opportunities. Unpublished drafts
              are visible only to you. Private calls, recordings, and internal
              information do not belong here.
            </p>
          </div>
          <button
            type="button"
            className="discovery-text-button"
            onClick={() => setEditingProfile(!editingProfile)}
            aria-expanded={editingProfile}
          >
            {editingProfile ? "Close profile editor" : "Edit your profile"}
          </button>
          {editingProfile && (
            <ProfileEditor
              demo={demo}
              initial={{
                headline: profile.headline,
                bio: profile.about,
                skills: profile.skills,
                opportunityGoals: profile.goal,
              }}
              onSave={async (profileDraft) => {
                if (onSaveProfile)
                  setProfile(await onSaveProfile(profileDraft));
                else if (demo)
                  setProfile((current) => ({
                    ...current,
                    headline: profileDraft.headline,
                    about: profileDraft.bio,
                    skills: profileDraft.skills,
                    goal: profileDraft.opportunityGoals,
                  }));
                else throw new Error("Profile saving is unavailable.");
              }}
            />
          )}
          <div className="discovery-results-bar">
            <div>
              <span className="discovery-eyebrow">Keep the story moving</span>
              <h2>Your journey</h2>
            </div>
            <button
              className="discovery-button"
              onClick={() => {
                setEditing(true);
                setNotice("");
              }}
            >
              <Plus size={18} aria-hidden="true" />
              Add a contribution
            </button>
          </div>
          {notice && <output className="discovery-notice">{notice}</output>}
          {editing && (
            <form
              className="discovery-panel discovery-entry-form"
              onSubmit={save}
            >
              <h2>What did you contribute?</h2>
              <p>
                A project, a useful fix, a talk, or something you learned. Be
                specific about your part.
              </p>
              <fieldset disabled={busy}>
                <legend className="discovery-sr-only">
                  Contribution details
                </legend>
                <label className="discovery-field">
                  Entry title
                  <input
                    value={draft.title}
                    onChange={(event) => change("title", event.target.value)}
                    maxLength={160}
                    required
                    placeholder="Made the library's borrowing flow keyboard accessible"
                  />
                </label>
                <label className="discovery-field">
                  Your contribution
                  <textarea
                    value={draft.description}
                    onChange={(event) =>
                      change("description", event.target.value)
                    }
                    maxLength={6000}
                    minLength={20}
                    required
                    rows={4}
                    placeholder="What did you do? What changed? Who did you work with?"
                  />
                </label>
                <div className="discovery-form-row">
                  <label className="discovery-field">
                    Date
                    <input
                      type="date"
                      value={draft.date}
                      onChange={(event) => change("date", event.target.value)}
                      required
                    />
                  </label>
                </div>
                <div className="discovery-form-divider">
                  <h3>Give the story a source</h3>
                  <p>
                    Optional for now. Add a project, code, or writing someone
                    can review. Only share links you have permission to share.
                  </p>
                </div>
                <label className="discovery-field">
                  Source link
                  <input
                    type="url"
                    value={draft.sourceUrl}
                    onChange={(event) =>
                      change("sourceUrl", event.target.value)
                    }
                    maxLength={2000}
                    placeholder="https://…"
                  />
                </label>
                {error && (
                  <p role="alert" className="discovery-error">
                    {error}
                  </p>
                )}
                <div className="discovery-actions">
                  <button className="discovery-button" disabled={busy}>
                    {busy ? "Saving…" : "Save contribution"}
                    <ArrowRight size={18} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="discovery-text-button"
                    onClick={() => setEditing(false)}
                  >
                    Keep draft and close
                  </button>
                </div>
              </fieldset>
            </form>
          )}
          <ol className="discovery-timeline">
            {claims.map((claim) => (
              <li key={claim.id}>
                <time dateTime={claim.date}>{claim.date}</time>
                <h3>{claim.title}</h3>
                {claim.visibility === "private" && (
                  <p className="discovery-notice">
                    Unpublished draft · Only you can see this contribution.
                  </p>
                )}
                <p>{claim.description}</p>
                <EvidenceLinks sources={claim.evidence} />
                <ClaimConfirmations claim={claim} />
              </li>
            ))}
          </ol>
          {claims.length === 0 && (
            <div className="discovery-empty">
              <h3>Your first contribution belongs here.</h3>
              <p>
                You do not need a finished portfolio. Start with one thing you
                made or learned.
              </p>
            </div>
          )}
        </section>
        <aside className="discovery-member-card">
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
          <span className="discovery-eyebrow">Your next chapter</span>
          <h2>{profile.name}</h2>
          <p>{profile.headline}</p>
          <div className="discovery-goal">
            <span className="discovery-eyebrow">Working toward</span>
            <p>{profile.goal}</p>
          </div>
          <h3>Make your contribution clear.</h3>
          <p>
            Say what was yours. Link the work. Describe what changed. A mentor
            can confirm the specific work they reviewed.
          </p>
          <p className="discovery-muted">
            A missing confirmation is an open question, not a mark against you.
          </p>
        </aside>
      </div>
    </DiscoveryShell>
  );
}
