// Local mock contract harness for the staging verifier. Never a deployed route.
import React from "react";
import { createRoot } from "react-dom/client";
import CommunityApp from "../../src/components/community/CommunityApp";
// oxlint-disable-next-line import/no-unassigned-import -- Real app styles in local browser test.
import "../../src/styles/global.css";
// oxlint-disable-next-line import/no-unassigned-import -- Real component styles in local browser test.
import "../../src/styles/discovery.css";
const view = window.location.pathname.endsWith("mentorship")
  ? "mentor"
  : window.location.pathname.endsWith("discover") ? "scout" : "journey";
createRoot(document.getElementById("root")!).render(<CommunityApp view={view} />);
