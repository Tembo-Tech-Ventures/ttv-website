import React from "react";
import { createRoot } from "react-dom/client";
import DemoAccessApp from "../../src/components/community/DemoAccessApp";
import DemoSessionControls from "../../src/components/community/DemoSessionControls";
// oxlint-disable-next-line import/no-unassigned-import -- Use real production styles in the local browser fixture.
import "./demo-access.css";
createRoot(document.getElementById("root")!).render(<main className="min-h-screen bg-dark p-4 text-ink-primary">
  <p>Local fictional UI fixture · Not a live session</p>
  {new URLSearchParams(location.search).has("controls") ? <DemoSessionControls activePersona="mentor" displayName="Fictional demo mentor" expiresAt="2026-10-26T18:00:00Z" /> : <DemoAccessApp activePersona={null} displayName="Demo operator" expiresAt="2026-10-26T23:00:00Z" canSwitch />}
</main>);
