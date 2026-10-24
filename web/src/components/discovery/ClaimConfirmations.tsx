import React from "react";
import { CheckCircle, ClockCounterClockwise } from "@phosphor-icons/react";
import type { JourneyClaim } from "./types";

export default function ClaimConfirmations({ claim }: { claim: JourneyClaim }) {
  if (claim.confirmations.length === 0)
    return (
      <p className="discovery-provenance">
        Member-reported · Not yet confirmed by a mentor
      </p>
    );
  return (
    <>
      {claim.confirmations.map((confirmation) => {
        const current = confirmation.journeyVersion === claim.version;
        return (
          <div className="discovery-confirmation" key={confirmation.id}>
            {current ? (
              <CheckCircle size={19} aria-hidden="true" />
            ) : (
              <ClockCounterClockwise size={19} aria-hidden="true" />
            )}
            <div>
              <strong>
                {current ? "Checked by" : "Previous revision checked by"}{" "}
                {confirmation.mentorName}
              </strong>
              <p>{confirmation.note}</p>
              <p>How it was checked: {confirmation.method}</p>
              <small>
                {confirmation.date} · Revision {confirmation.journeyVersion}
                {current
                  ? " · Claim-specific confirmation"
                  : ` · Review needed for current revision ${claim.version}`}
              </small>
            </div>
          </div>
        );
      })}
    </>
  );
}
