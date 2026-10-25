import React from "react";
import { createRoot } from "react-dom/client";
import OrganizerPage from "../../src/components/hackathon/OrganizerPage";
// oxlint-disable-next-line import/no-unassigned-import -- Production styles in local fixture.
import "../../src/styles/global.css";
// oxlint-disable-next-line import/no-unassigned-import -- Production styles in local fixture.
import "../../src/styles/hackathon.css";
createRoot(document.getElementById("root")!).render(<OrganizerPage />);
