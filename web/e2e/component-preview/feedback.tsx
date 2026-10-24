import React from "react";
import { createRoot } from "react-dom/client";
import FeedbackWidget from "../../src/components/feedback/FeedbackWidget";
// oxlint-disable-next-line import/no-unassigned-import -- Real styles for the browser fixture.
import "../../src/styles/global.css";

createRoot(document.getElementById("root")!).render(
  <>
    <p>Fictional feedback fixture · Mock responses · No live authentication</p>
    <FeedbackWidget />
  </>,
);
