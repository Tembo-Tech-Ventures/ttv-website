import DemoReturnButton from "./DemoReturnButton";
import React, { useRef, useState } from "react";
import DemoRoleChooser, { type DemoPersona, type DemoAccessError } from "./DemoRoleChooser";
import DemoSessionIndicator from "./DemoSessionIndicator";
import { DemoRequestError, requestDemoAction } from "./demo-access-client";

export interface DemoAccessAppProps {
  activePersona: DemoPersona | null;
  displayName: string;
  expiresAt: string;
  canSwitch: boolean;
}

/** Mount only after the server's staging operator gate succeeds. */
export default function DemoAccessApp(props: DemoAccessAppProps) {
  const [pending, setPending] = useState<DemoPersona | "logout" | null>(null);
  const [error, setError] = useState<DemoAccessError | null>(null);
  const [logoutError, setLogoutError] = useState(false);
  const submitting = useRef(false);

  async function act(persona: DemoPersona | null) {
    if (submitting.current || (persona !== null && !props.canSwitch)) return;
    submitting.current = true;
    setPending(persona ?? "logout");
    setError(null);
    setLogoutError(false);
    try {
      window.location.assign(await requestDemoAction(persona));
    } catch (failure) {
      const code = failure instanceof DemoRequestError ? failure.code : "failed";
      if (code === "expired") window.location.assign("/demo");
      if (persona === null) setLogoutError(true);
      else setError(code);
      setPending(null);
      submitting.current = false;
    }
  }

  return (
    <>
      <DemoRoleChooser {...props} canSwitch={props.canSwitch && pending !== "logout"} pendingPersona={pending === "logout" ? null : pending} error={error} onSelect={(persona) => { void act(persona); }} />
      <div className="mx-auto max-w-3xl px-4 pb-10 sm:px-8">
        {props.activePersona ? <DemoSessionIndicator {...props} activePersona={props.activePersona} canSwitch={false} error={logoutError} pending={pending === "logout" ? "logout" : pending ? "switch" : null} onSwitch={() => {}} onLogout={() => { void act(null); }} /> : <button type="button" disabled={pending !== null} onClick={() => { void act(null); }} className="min-h-11 rounded-full border border-primary px-5 py-2 font-semibold text-primary disabled:opacity-60">{pending === "logout" ? "Signing out…" : "Sign out of staging"}</button>}
        {logoutError && !props.activePersona && <p role="alert" className="mt-3 text-sm">We could not sign you out. Please try again.</p>}
        <DemoReturnButton />
        <p className="mt-3 text-sm text-ink-muted">Sign out ends this demo and the original admin session. To try another role, choose it above.</p>
      </div>
    </>
  );
}
