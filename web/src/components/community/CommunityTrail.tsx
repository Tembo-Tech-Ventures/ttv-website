import React, { type ReactNode } from "react";

/** Full-size surfaces share one grid cell, so every layer follows the content. */
export default function CommunityTrail({ children }: { children: ReactNode }) {
  return <div className="audience-stack" data-card-stack>
    <div className="audience-stack__card audience-stack__card--back" aria-hidden="true" />
    <div className="audience-stack__card audience-stack__card--middle" aria-hidden="true" />
    <figure className="audience-trail" aria-labelledby="trail-caption">{children}</figure>
  </div>;
}
