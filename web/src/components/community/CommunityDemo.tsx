import React from "react";
import ScoutWorkspace from "../discovery/ScoutWorkspace";
import DiscoveryShell from "../discovery/DiscoveryShell";
import { demoProfiles } from "../discovery/fixtures";
import JourneyWorkspace from "./JourneyWorkspace";
import MentorReview from "./MentorReview";

export default function CommunityDemo({
  view,
  fail = false,
}: {
  view: string;
  fail?: boolean;
}) {
  const profile = demoProfiles[0];
  if (view === "journey")
    return (
      <JourneyWorkspace
        profile={profile}
        demo
        onSave={
          fail
            ? async () => {
                throw new Error(
                  "Demo: saving failed. Your draft is still here.",
                );
              }
            : undefined
        }
      />
    );
  if (view === "mentor")
    return (
      <DiscoveryShell active="mentor" demo>
        <div className="discovery-page-heading">
          <div>
            <span className="discovery-eyebrow">
              Mentor workspace / contributions
            </span>
            <h1>
              Recognise the work.
              <br />
              <em>Name what you saw.</em>
            </h1>
          </div>
          <p>
            Your perspective gives a contribution context. Confirm only what you
            personally reviewed.
          </p>
        </div>
        <MentorReview
          demo
          requests={[
            {
              id: "demo-review",
              memberName: profile.name,
              claimTitle: profile.claims[0].title,
              claimDescription: profile.claims[0].description,
              evidence: profile.claims[0].evidence,
              status: "pending",
            },
          ]}
          onReview={async () => {
            if (fail) throw new Error("Demo save failure");
          }}
        />
      </DiscoveryShell>
    );
  return (
    <ScoutWorkspace
      profiles={demoProfiles}
      demo
      onSearch={
        fail
          ? async () => {
              throw new Error(
                "Demo: search failed. Your criteria are still here.",
              );
            }
          : undefined
      }
    />
  );
}
