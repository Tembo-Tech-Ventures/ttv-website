import React from "react";
import { createRoot } from "react-dom/client";
import CommunityIntro, { CommunityJourneyCard } from "../../src/components/community/CommunityIntro";
import DashboardShell from "../../src/components/shells/DashboardShell";
// oxlint-disable-next-line import/no-unassigned-import -- Actual app styles for browser verification.
import "./community-entry.css";

const dashboard = new URLSearchParams(location.search).has("dashboard");
createRoot(document.getElementById("root")!).render(dashboard ? (
  <DashboardShell currentPath="/dashboard" visibleLinkIds={["home", "apply", "ask", "account"]}>
    <CommunityJourneyCard />
  </DashboardShell>
) : (
  <div className="min-h-screen bg-dark"><p className="px-4 py-3 text-sm text-ink-muted">Component preview · No live authentication or member data</p><CommunityIntro full /></div>
));
