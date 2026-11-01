import React, { useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowRight, Plus } from "@phosphor-icons/react";
import DiscoveryShell from "../discovery/DiscoveryShell";
import { EvidenceLinks } from "../discovery/ScoutWorkspace";

import type { CommunityProfile, JourneyClaim } from "../discovery/types";
import ClaimConfirmations from "../discovery/ClaimConfirmations";
import { UiApiError, displayUiError } from "../discovery/ui-errors";
import ProfileEditor, { type EditableCommunityProfile } from "./ProfileEditor";
import { PARTNER } from "@/components/platform/onboarding/copy";
import type { CommunityFraming } from "@/components/platform/onboarding/framing";

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
  framing = "member",
  onSave,
  onUpdate,
  onSaveProfile,
}: {
  profile: CommunityProfile;
  demo?: boolean;
  /**
   * How onboarding frames Community for this person (platform/onboarding/framing.ts).
   * Someone just looking around has a welcome card above instead of the first
   * contribution prompt; mentors and organisations keep their own work under
   * its own name, without a student's prompt.
   */
  framing?: CommunityFraming;
  onSave?: (draft: ClaimDraft) => Promise<JourneyClaim>;
  onUpdate?: (claim: JourneyClaim, draft: ClaimDraft) => Promise<JourneyClaim>;
  onSaveProfile?: (
    draft: EditableCommunityProfile,
  ) => Promise<CommunityProfile>;
}) {
  const [profile, setProfile] = useState(initialProfile);
  const [claims, setClaims] = useState(initialProfile.claims);
  const [editingProfile, setEditingProfile] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editingClaim,setEditingClaim]=useState<JourneyClaim|null>(null);
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
      if(editingClaim && onUpdate) claim=await onUpdate(editingClaim,draft);
      else if(editingClaim && demo) claim={...editingClaim,title:draft.title.trim(),description:draft.description.trim(),date:draft.date,version:editingClaim.version+1,evidence:draft.sourceUrl.trim()?[{id:editingClaim.id,title:"Supporting work",url:draft.sourceUrl.trim(),kind:"Member source"}]:[]};
      else if(editingClaim) throw new Error("Editing unavailable.");
      else if (onSave) claim = await onSave(draft);
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
      setClaims((current) => editingClaim ? current.map(item=>item.id===claim.id?claim:item) : [claim, ...current]);
      setEditingClaim(null);
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
          : editingClaim ? "Your contribution has been updated. Earlier mentor statements remain attached to their reviewed revision." : "Your contribution has been saved.",
      );
    } catch (cause) {
      setError(
        editingClaim && cause instanceof UiApiError && cause.status === 409 ? "This contribution changed since you opened it. Reload before editing; your draft is still here." : displayUiError(
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
          <h1>
            Your work.
            <br />
            <em>Your story.</em>
          </h1>
        </div>
        <p>
          Show what you made, what you learned, and the part that was yours.
        </p>
      </div>
      <div className="discovery-member-grid">
        <section>
          <div className="discovery-visibility">
            <strong>Who can discover this?</strong>
            <p>
              Approved institutions can discover your saved community profile
              and the contributions you share. Mentors can review those shared
              contributions. Private contributions remain visible only to you.
              Private calls, recordings, and internal information
              do not belong here.
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
              <h2>{framing === "partner" ? PARTNER.ownWork : "Your journey"}</h2>
            </div>
            <button
              className="discovery-button"
              disabled={busy}
              onClick={() => {
                setEditingClaim(null);
                if(editingClaim)setDraft({title:"",description:"",date:"",sourceUrl:""});
                setEditing(true);
                setNotice("");
                setError("");
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
              aria-describedby="contribution-sharing"
            >
              <h2>{editingClaim ? "Edit your contribution" : "What did you contribute?"}</h2>
              {editingClaim && <p>Editing creates a new revision. Earlier mentor statements stay with the revision they reviewed.</p>}
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
                <p id="contribution-sharing" className="discovery-notice">
                  {editingClaim?.visibility === "private" ? "Saving keeps this contribution private. Earlier mentor statements remain part of its revision history." : "Saving shares this contribution with approved institutions and makes it available for mentor review. This is not a private draft."}
                </p>
                <div className="discovery-actions">
                  <button className="discovery-button" disabled={busy}>
                    {busy ? "Saving…" : editingClaim ? "Save changes" : "Save contribution"}
                    <ArrowRight size={18} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="discovery-text-button"
                    onClick={() => setEditing(false)}
                  >
                    Close editor
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
                {(onUpdate || demo) && <button type="button" className="discovery-text-button" disabled={busy} onClick={()=>{
                  setEditingClaim(claim);setDraft({title:claim.title,description:claim.description,date:claim.date,sourceUrl:claim.evidence[0]?.url??""});setEditing(true);setError("");setNotice("");
                }}>Edit {claim.title}</button>}
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
          {claims.length === 0 && framing === "member" && (
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
          <h2>{profile.name}</h2>
          <p>{profile.headline}</p>
          <div className="discovery-goal">
            <strong>Opportunity goals</strong>
            <p>{profile.goal}</p>
          </div>
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
