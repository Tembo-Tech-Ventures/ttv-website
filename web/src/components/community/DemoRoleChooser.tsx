import React from "react";

export const demoRoles = [
  { key: "member-cohort", label: "Cohort member", description: "Record your work and seek feedback as a member of a fictional cohort." },
  { key: "member-noncohort", label: "Community member", description: "Build your community profile outside a cohort." },
  { key: "mentor", label: "Mentor", description: "Review a specific contribution and add context to the work." },
  { key: "institution", label: "Institution", description: "Find people, explore their evidence, and decide what to ask next." },
] as const;

export type DemoPersona = (typeof demoRoles)[number]["key"];
export type DemoAccessError = "expired" | "forbidden" | "unavailable" | "failed";

export function demoAccessErrorMessage(error: DemoAccessError): string {
  switch (error) {
    case "expired": return "Your demo access has expired. Return to the demo entry to continue.";
    case "forbidden": return "This session cannot switch demo roles.";
    case "unavailable": return "The demo profiles are not ready yet. Please try again later.";
    case "failed": return "We could not change your demo role. Please try again.";
  }
}

export interface DemoRoleChooserProps {
  activePersona: DemoPersona | null;
  canSwitch: boolean;
  pendingPersona?: DemoPersona | null;
  error?: DemoAccessError | null;
  onSelect: (persona: DemoPersona) => void;
}

/** Presentation only. The server must authorize every persona switch. */
export default function DemoRoleChooser({ activePersona, canSwitch, pendingPersona = null, error = null, onSelect }: DemoRoleChooserProps) {
  const blocked = !canSwitch || pendingPersona !== null || error === "expired" || error === "forbidden";
  return (
    <section aria-label="Choose a demo role" className="mx-auto w-full max-w-3xl px-4 py-10 text-ink-primary sm:px-8">
      <h1 className="font-heading text-3xl sm:text-4xl">Choose a demo role</h1>
      <p className="mt-4 text-ink-secondary">Explore the community through four perspectives. These profiles and their contributions are fictional.</p>
      <output aria-live="polite" className="mt-4 block text-sm text-ink-secondary">
        {pendingPersona ? "Opening your demo workspace…" : !canSwitch ? "Demo role switching is unavailable for this session." : "Choose a role to open its workspace."}
      </output>
      {error && <p role="alert" className="mt-4 text-sm text-ink-primary">{demoAccessErrorMessage(error)} {error === "expired" && <a href="/demo" className="underline underline-offset-4">Return to demo entry</a>}</p>}
      <div className="mt-6 grid gap-4 sm:grid-cols-2" aria-busy={pendingPersona !== null}>
        {demoRoles.map((role) => (
          <button key={role.key} type="button" disabled={blocked} onClick={() => { if (!blocked) onSelect(role.key); }} className="min-w-0 rounded-xl border border-[color:var(--color-rule)] bg-dark p-6 text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary enabled:hover:border-primary disabled:cursor-not-allowed disabled:opacity-60">
            <span className="block font-heading text-xl text-primary">{role.label}</span>
            <span className="mt-3 block text-sm leading-relaxed text-ink-secondary">{role.description}</span>
            {activePersona === role.key && <span className="mt-3 block text-sm text-primary">Current role</span>}
          </button>
        ))}
      </div>
      <p className="mt-6 text-sm text-ink-muted">Both member roles can build a community profile. Cohort membership is separate from community access.</p>
    </section>
  );
}
