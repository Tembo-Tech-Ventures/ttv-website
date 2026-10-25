import React from "react";
import { demoRoles, type DemoPersona } from "./DemoRoleChooser";

export interface DemoSessionIndicatorProps {
  activePersona: DemoPersona;
  displayName: string;
  /** ISO timestamp supplied by the server. Never a credential. */
  expiresAt: string;
  canSwitch: boolean;
  pending?: "switch" | "logout" | null;
  error?: boolean;
  /** The host must confirm discarding unsaved work before changing location. */
  onSwitch: () => void;
  onLogout: () => void;
}

/** Controlled UI only; does not mint, store, or revoke sessions itself. */
export default function DemoSessionIndicator({ activePersona, displayName, expiresAt, canSwitch, pending = null, error = false, onSwitch, onLogout }: DemoSessionIndicatorProps) {
  const role = demoRoles.find((candidate) => candidate.key === activePersona);
  const expiry = new Date(expiresAt);
  const expiryIso = Number.isFinite(expiry.getTime()) ? expiry.toISOString() : null;
  return (
    <aside aria-label="Demo session" className="rounded-xl border border-[color:var(--color-rule)] bg-dark p-4 text-ink-primary">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0 break-words">
          <p className="font-semibold">{displayName} · {role?.label}</p>
          <p className="mt-1 text-sm text-ink-secondary">Fictional demo profile</p>
          {expiryIso && <p className="mt-1 text-xs text-ink-muted">Session ends <time dateTime={expiryIso}>{expiryIso.slice(0, 16).replace("T", " ")} UTC</time></p>}
        </div>
        <div className="flex flex-wrap gap-3">
          {canSwitch && <button type="button" disabled={pending !== null} onClick={() => { if (!pending) onSwitch(); }} className="min-h-11 rounded-full border border-primary px-4 py-2 text-sm font-semibold text-primary focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary disabled:opacity-60">Switch role</button>}
          <button type="button" disabled={pending !== null} onClick={() => { if (!pending) onLogout(); }} className="min-h-11 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-dark focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary disabled:opacity-60">Sign out of staging</button>
        </div>
      </div>
      <output aria-live="polite" className="mt-2 block text-sm text-ink-secondary">{pending === "logout" ? "Signing out…" : pending === "switch" ? "Opening role selection…" : ""}</output>
      {error && <p role="alert" className="mt-2 text-sm">That action could not be completed. Please try again.</p>}
    </aside>
  );
}
