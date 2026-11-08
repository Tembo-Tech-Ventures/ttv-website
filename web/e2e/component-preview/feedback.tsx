import { createRoot } from "react-dom/client";
import FeedbackLauncher from "../../src/components/feedback/FeedbackLauncher";
import { installFeedbackLoader } from "../../src/components/feedback/feedback-loader";
// oxlint-disable-next-line import/no-unassigned-import -- Real styles for the browser fixture.
import "./community-entry.css";

// As on a page: the launcher is plain markup, and the loader brings in the form on the first press.
createRoot(document.getElementById("root")!).render(
  <>
    <p>Fictional feedback fixture · Mock responses · No live authentication</p>
    <FeedbackLauncher />
  </>,
);
installFeedbackLoader();
