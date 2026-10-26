import DemoReturnButton from "./DemoReturnButton";
import React, { useEffect, useRef, useState } from "react";
import DemoSessionIndicator from "./DemoSessionIndicator";
import type { DemoPersona } from "./DemoRoleChooser";
import { DemoRequestError, requestDemoAction } from "./demo-access-client";

type Action = "switch" | "logout";
export async function leaveDemoWorkspace(action: Action, effects: {
  confirm: (message: string) => boolean;
  navigate: (path: string) => void;
  logout: () => Promise<string>;
}) {
  const message = action === "logout"
    ? "Sign out of staging and end the original admin session? Unsaved changes on this page will be lost."
    : "Return to demo role selection? Unsaved changes on this page will be lost.";
  if (!effects.confirm(message)) return false;
  const destination = action === "logout" ? await effects.logout() : "/demo";
  effects.navigate(destination);
  return true;
}

/** Only mount from a server-validated stagingDemo local, never client role flags. */
export default function DemoSessionControls(props: { activePersona: DemoPersona; displayName: string; expiresAt: string }) {
  const [pending, setPending] = useState<Action | null>(null);
  const [error, setError] = useState(false);
  const busy = useRef(false);
  const [confirmation, setConfirmation] = useState<Action | null>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirmation) cancelButton.current?.focus(); }, [confirmation]);
  async function act(action: Action) {
    if (busy.current) return;
    busy.current = true;
    setConfirmation(null);
    setPending(action);
    setError(false);
    try {
      const leaving = await leaveDemoWorkspace(action, {
        confirm: () => true,
        navigate: (path) => window.location.assign(path),
        logout: () => requestDemoAction(null),
      });
      if (leaving) return;
    } catch (failure) {
      if (failure instanceof DemoRequestError && failure.code === "expired") window.location.assign("/demo");
      setError(true);
    }
    busy.current = false;
    setPending(null);
  }
  return <>
    <DemoSessionIndicator {...props} canSwitch pending={pending} error={error} onSwitch={() => setConfirmation("switch")} onLogout={() => setConfirmation("logout")} />
    <DemoReturnButton />
    {confirmation && <section aria-label="Confirm leaving this workspace" className="mt-3 rounded-xl border border-primary bg-dark p-4 text-ink-primary">
      <p role="alert">{confirmation === "logout" ? "Sign out of staging and end the original admin session?" : "Return to demo role selection?"} Unsaved changes on this page will be lost.</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button ref={cancelButton} type="button" onClick={() => setConfirmation(null)} className="min-h-11 rounded-full border border-primary px-4 py-2 text-primary">Keep working</button>
        <button type="button" onClick={() => { void act(confirmation); }} className="min-h-11 rounded-full bg-primary px-4 py-2 font-semibold text-dark">{confirmation === "logout" ? "Confirm sign out" : "Confirm switch"}</button>
      </div>
    </section>}
  </>;
}
