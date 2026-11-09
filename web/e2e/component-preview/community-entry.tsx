import React from "react";
import { createRoot } from "react-dom/client";
import CommunityIntro from "../../src/components/community/CommunityIntro";
// oxlint-disable-next-line import/no-unassigned-import -- Actual app styles for browser verification.
import "./community-entry.css";

createRoot(document.getElementById("root")!).render(
  <div className="min-h-screen bg-dark"><p className="px-4 py-3 text-sm text-ink-muted">Component preview · No live authentication or member data</p><CommunityIntro full /></div>,
);
