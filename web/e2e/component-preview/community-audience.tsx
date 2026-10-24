import React from "react";
import { createRoot } from "react-dom/client";
import CommunityPartnerPage from "../../src/components/community/CommunityPartnerPage";
import CommunityAudiencePage from "../../src/components/community/CommunityAudiencePage";
// oxlint-disable-next-line import/no-unassigned-import -- Actual app styles for local browser verification.
import "./community-entry.css";
// oxlint-disable-next-line import/no-unassigned-import -- Actual audience-page stylesheet.
import "../../src/styles/community-audience.css";
const query = new URLSearchParams(location.search);
const audience = query.get("audience");
createRoot(document.getElementById("root")!).render(<>
  <header className="mx-auto flex max-w-7xl items-center justify-between border-b border-primary/20 px-6 py-5"><a href="/" className="font-heading text-xl">TEMBO</a><span className="text-xs text-ink-muted">Local component preview · fictional content</span></header>
  <main>{audience === "mentors" || audience === "institutions" ? <CommunityPartnerPage audience={audience} isAuthenticated={query.has("signed-in")} /> : <CommunityAudiencePage isAuthenticated={query.has("signed-in")} />}</main>
</>);
