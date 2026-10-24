import React, { useId, useRef, useState } from "react";

export interface EditableCommunityProfile {
  headline: string;
  bio: string;
  skills: string[];
  opportunityGoals: string;
}

export interface ProfileEditorProps {
  initial: EditableCommunityProfile;
  onSave: (profile: EditableCommunityProfile) => Promise<void>;
  demo?: boolean;
}

export function parseProfileSkills(value: string): string[] {
  return value
    .split(",")
    .map((skill) => skill.trim())
    .filter(Boolean);
}

export function validateCommunityProfile(
  profile: EditableCommunityProfile,
): string | null {
  if (profile.headline.length > 160)
    return "Keep your headline within 160 characters.";
  if (profile.bio.length > 4000)
    return "Keep the description of your work within 4,000 characters.";
  if (profile.skills.length > 20) return "Add no more than 20 skills.";
  if (profile.skills.some((skill) => skill.length > 60))
    return "Keep each skill within 60 characters.";
  if (profile.opportunityGoals.length > 1000)
    return "Keep your opportunity goals within 1,000 characters.";
  return null;
}

export default function ProfileEditor({
  initial,
  onSave,
  demo = false,
}: ProfileEditorProps) {
  const id = useId();
  const [draft, setDraft] = useState(() => ({
    ...initial,
    skills: initial.skills.join(", "),
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const submitting = useRef(false);

  function change(field: keyof typeof draft, value: string) {
    setDraft((previous) => ({ ...previous, [field]: value }));
    setSaved(false);
    setError(null);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    const profile: EditableCommunityProfile = {
      headline: draft.headline.trim(),
      bio: draft.bio.trim(),
      skills: parseProfileSkills(draft.skills),
      opportunityGoals: draft.opportunityGoals.trim(),
    };
    const validation = validateCommunityProfile(profile);
    setSaved(false);
    if (validation) {
      setError(validation);
      return;
    }
    submitting.current = true;
    setBusy(true);
    setError(null);
    try {
      await onSave(profile);
      setSaved(true);
    } catch {
      setError(
        "Your profile could not be saved. Your draft is still here; please try again.",
      );
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  }

  return (
    <section className="discovery-panel" aria-labelledby={`${id}-heading`}>
      <p className="discovery-eyebrow">Your community profile</p>
      <h2 id={`${id}-heading`}>Describe your work and what comes next</h2>
      <p>
        Share your experience, skills and the opportunities you want to explore.
      </p>
      {demo && (
        <p className="discovery-notice">
          Demo profile · Changes here are demonstration actions, not updates to
          a real member profile.
        </p>
      )}
      <form
        onSubmit={submit}
        aria-busy={busy}
        aria-describedby={error ? `${id}-error` : undefined}
      >
        <fieldset disabled={busy}>
          <legend>Profile details</legend>
          <label className="discovery-field" htmlFor={`${id}-headline`}>
            Headline
            <input
              id={`${id}-headline`}
              value={draft.headline}
              maxLength={160}
              onChange={(event) => change("headline", event.target.value)}
            />
          </label>
          <label className="discovery-field" htmlFor={`${id}-bio`}>
            About your work
            <textarea
              id={`${id}-bio`}
              value={draft.bio}
              maxLength={4000}
              rows={6}
              onChange={(event) => change("bio", event.target.value)}
            />
          </label>
          <label className="discovery-field" htmlFor={`${id}-skills`}>
            Skills (comma-separated)
            <input
              id={`${id}-skills`}
              value={draft.skills}
              aria-describedby={`${id}-skills-help`}
              onChange={(event) => change("skills", event.target.value)}
            />
          </label>
          <p id={`${id}-skills-help`}>
            Separate skills with commas. Add up to 20 skills, each no longer
            than 60 characters.
          </p>
          <label className="discovery-field" htmlFor={`${id}-goals`}>
            Opportunity goals
            <textarea
              id={`${id}-goals`}
              value={draft.opportunityGoals}
              maxLength={1000}
              rows={4}
              onChange={(event) =>
                change("opportunityGoals", event.target.value)
              }
            />
          </label>
          <button className="discovery-button" type="submit">
            {busy
              ? "Saving profile…"
              : demo
                ? "Save demo profile"
                : "Save profile"}
          </button>
        </fieldset>
        {error && (
          <p className="discovery-error" id={`${id}-error`} role="alert">
            {error}
          </p>
        )}
        <output className="discovery-notice">
          {saved ? (demo ? "Demo profile saved." : "Profile saved.") : ""}
        </output>
      </form>
    </section>
  );
}
