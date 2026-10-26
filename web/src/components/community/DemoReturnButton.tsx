import React, { useEffect, useRef, useState } from "react";
import { requestDemoAction } from "./demo-access-client";

/** Restore the original admin cookie only after the server revalidates its session. */
export default function DemoReturnButton() {
  const busy = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const cancelButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (confirming) cancelButton.current?.focus(); }, [confirming]);
  async function stop() {
    if (busy.current) return;
    setConfirming(false);
    busy.current = true; setPending(true); setError(false);
    try { window.location.assign(await requestDemoAction("admin")); }
    catch { busy.current = false; setPending(false); setError(true); }
  }
  return <div className="mt-3">
    <button type="button" disabled={pending} onClick={() => setConfirming(true)} className="min-h-11 rounded-full border border-primary px-5 py-2 font-semibold text-primary disabled:opacity-60">{pending ? "Returning to admin…" : "Stop impersonating · Return to admin"}</button>
    {confirming && <section aria-label="Confirm returning to admin" className="mt-3 rounded-xl border border-primary p-4">
      <p role="alert">Return to your original admin session? Unsaved changes will be lost.</p>
      <div className="mt-3 flex flex-wrap gap-3">
        <button ref={cancelButton} type="button" onClick={() => setConfirming(false)} className="min-h-11 rounded-full border border-primary px-4 py-2">Keep working</button>
        <button type="button" onClick={() => { void stop(); }} className="min-h-11 rounded-full bg-primary px-4 py-2 text-dark">Confirm return to admin</button>
      </div>
    </section>}
    {error && <p role="alert" className="mt-2 text-sm">Could not restore the admin session. It may have expired or been revoked. Sign in to staging again.</p>}
  </div>;
}
