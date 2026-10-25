import React from "react";
import { createRoot } from "react-dom/client";
import DashboardShell from "../../src/components/shells/DashboardShell";
import { CommunityJourneyCard } from "../../src/components/community/CommunityIntro";
import { dashboardNextStep } from "../../src/lib/dashboard-presentation";
// oxlint-disable-next-line import/no-unassigned-import -- Production styles in local test fixture.
import "./institution-entry.css";
const canDiscover = new URLSearchParams(location.search).get("role") === "institution";
const step = dashboardNextStep({ title: "Find your next cohort", description: "Explore member activities.", detail: null, action: { href: "/dashboard/apply", label: "Apply" } }, canDiscover);
createRoot(document.getElementById("root")!).render(<DashboardShell currentPath="/dashboard" visibleLinkIds={["home", "apply", "ask", "account"]} canDiscover={canDiscover}>
  <div className="mx-auto max-w-3xl space-y-6"><p className="text-ink-muted">Fictional institution · Component fixture · No live authentication</p><section className="rounded-xl border border-teal/20 p-8"><h2 className="text-3xl text-white">{step.title}</h2><p className="mt-4 text-ink-secondary">{step.description}</p><p className="mt-4 text-ink-muted">{step.detail}</p><a className="mt-6 inline-block rounded-xl bg-primary p-3 text-dark" href={step.action.href}>{step.action.label}</a></section><CommunityJourneyCard /></div>
</DashboardShell>);
