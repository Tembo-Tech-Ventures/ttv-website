import React, { useEffect, useMemo, useState } from "react";
import DiscoveryShell, {
  CommunityNavigation,
} from "../discovery/DiscoveryShell";
import ScoutWorkspace from "../discovery/ScoutWorkspace";
import JourneyWorkspace from "./JourneyWorkspace";
import MentorReview, { type MentorReviewRequest } from "./MentorReview";
import type { CommunityProfile } from "../discovery/types";
import { displayUiError } from "../discovery/ui-errors";
import {
  loadAccess,
  loadOwnProfile,
  loadMentorship,
  searchProfiles,
  loadProfile,
  saveProfile,
  saveContribution,
  updateContribution,
  confirmContribution,
  askProfile,
  orderProfilesByEvidence,
  type CommunityAccess,
} from "./community-client";

import { assessProfile } from "./assessment-client";

type View = "journey" | "scout" | "mentor";
export function canOpenWorkspace(view: View, access: CommunityAccess) {
  return (
    view === "journey" ||
    access.isAdmin ||
    (view === "scout" ? access.isInstitution : access.isMentor)
  );
}

export default function CommunityApp({ view }: { view: View }) {
  const [access, setAccess] = useState<CommunityAccess | null>(null);
  const [profile, setProfile] = useState<CommunityProfile | null>(null);
  const [requests, setRequests] = useState<MentorReviewRequest[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    async function load() {
      setBusy(true);
      setError("");
      try {
        const roleAccess = await loadAccess();
        if (!active) return;
        setAccess(roleAccess);
        if (!canOpenWorkspace(view, roleAccess)) return;
        if (view === "scout") {
          const profileId = new URLSearchParams(window.location.search).get(
            "profile",
          );
          if (profileId) {
            const linkedProfile = await loadProfile(profileId);
            if (active) setProfile(linkedProfile);
          }
        }
        if (view === "journey") {
          const ownProfile = await loadOwnProfile();
          if (active) setProfile(ownProfile);
        }
        if (view === "mentor") {
          const queue = await loadMentorship();
          if (active) setRequests(queue);
        }
      } catch (cause) {
        if (active)
          setError(
            displayUiError(
              cause,
              "We could not load this workspace. Please try again.",
            ),
          );
      } finally {
        if (active) setBusy(false);
      }
    }
    void load();
    return () => {
      active = false;
    };
  }, [view, attempt]);
  const navigation = useMemo(() => {
    const views: View[] = ["journey"];
    if (access?.isAdmin || access?.isInstitution) views.push("scout");
    if (access?.isAdmin || access?.isMentor) views.push("mentor");
    return views;
  }, [access]);
  let content: React.ReactNode;
  if (busy)
    content = (
      <DiscoveryShell active={view}>
        <output className="discovery-notice">Loading your workspace…</output>
      </DiscoveryShell>
    );
  else if (error)
    content = (
      <DiscoveryShell active={view}>
        <section className="discovery-empty">
          <h1>We could not open this workspace.</h1>
          <p role="alert">{error}</p>
          <button
            className="discovery-button"
            onClick={() => setAttempt((current) => current + 1)}
          >
            Try again
          </button>
          <p>
            <a href="/auth/login">Sign in again</a>
          </p>
          <p>
            <a href="/dashboard/discover">Start a new discovery</a>
          </p>
        </section>
      </DiscoveryShell>
    );
  else if (access && !canOpenWorkspace(view, access))
    content = (
      <DiscoveryShell active={view}>
        <section className="discovery-empty">
          <h1>
            {view === "scout"
              ? "Institutional access needs approval."
              : "Mentor access needs approval."}
          </h1>
          <p>
            Signing in gives you a community profile. An administrator must
            approve this additional access.
          </p>
          <a className="discovery-button" href="/dashboard/community">
            Go to your journey
          </a>
        </section>
      </DiscoveryShell>
    );
  else if (view === "scout")
    content = (
      <ScoutWorkspace
        profiles={[]}
        initialProfile={profile}
        onSearch={searchProfiles}
        onOpenProfile={loadProfile}
        onAsk={askProfile}
        onOrder={orderProfilesByEvidence}
        onAssess={assessProfile}
      />
    );
  else if (view === "journey" && profile)
    content = (
      <JourneyWorkspace
        profile={profile}
        onSave={saveContribution}
        onUpdate={updateContribution}
        onSaveProfile={saveProfile}
      />
    );
  else
    content = (
      <DiscoveryShell active="mentor">
        <div className="discovery-page-heading">
          <div>
            <span className="discovery-eyebrow">Mentor workspace</span>
            <h1>
              Recognise the work.
              <br />
              <em>Name what you saw.</em>
            </h1>
          </div>
          <p>
            Review the contribution and its sources before recording what you
            checked.
          </p>
        </div>
        <MentorReview requests={requests} onReview={confirmContribution} />
        <button
          className="discovery-button-secondary"
          onClick={() => setAttempt((current) => current + 1)}
        >
          Refresh contributions
        </button>
      </DiscoveryShell>
    );
  return (
    <CommunityNavigation.Provider value={navigation}>
      {content}
    </CommunityNavigation.Provider>
  );
}
