// Component-only browser harness. No authentication or backend is simulated.
import React from "react";
import { createRoot } from "react-dom/client";
import CommunityDemo from "../../src/components/community/CommunityDemo";
// oxlint-disable-next-line import/no-unassigned-import -- Real app styles for component browser tests.
import "../../src/styles/global.css";
// oxlint-disable-next-line import/no-unassigned-import -- Real component stylesheet.
import "../../src/styles/discovery.css";

const params = new URLSearchParams(window.location.search);
createRoot(document.getElementById("root")!).render(
  <CommunityDemo
    view={params.get("view") ?? "scout"}
    fail={params.get("fail") === "1"}
  />,
);
