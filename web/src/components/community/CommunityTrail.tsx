import React, { type ReactNode } from "react";

/** Full-size surfaces share one grid cell, so every layer follows the content. */
export default function CommunityTrail({ children, story }: { children: ReactNode; story: "members" | "mentors" | "institutions" }) {
  const motif = <svg className="audience-stack__map" viewBox="0 0 400 500" fill="none" aria-hidden="true">
    <ellipse cx="200" cy="250" rx="146" ry="178" />
    <ellipse cx="200" cy="250" rx="95" ry="118" />
    <path d="M100 120L200 250L300 380" />
    {story === "members" ? <circle className="audience-stack__symbol" cx="200" cy="250" r="23" />
      : story === "mentors" ? <circle className="audience-stack__symbol audience-stack__symbol--open audience-stack__symbol--mentor" cx="200" cy="250" r="29" />
        : <path className="audience-stack__symbol audience-stack__symbol--open" d="M200 218L232 250L200 282L168 250Z" />}
    <circle cx="100" cy="120" r="5" /><circle cx="300" cy="380" r="5" />
  </svg>;
  return <div className="audience-stack" data-card-stack data-story={story}>
    <div className="audience-stack__card audience-stack__card--back" aria-hidden="true">{motif}</div>
    <div className="audience-stack__card audience-stack__card--middle" aria-hidden="true">{motif}</div>
    <figure className="audience-trail" aria-labelledby="trail-caption">{children}</figure>
  </div>;
}
