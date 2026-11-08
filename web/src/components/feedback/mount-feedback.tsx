import { createRoot } from "react-dom/client";
import { CAPTURE_IGNORE_ATTRIBUTE } from "./feedback-client";
import FeedbackDialog from "./FeedbackDialog";
import type { OpenFeedback } from "./feedback-loader";

/** Mounts the form once, outside the page's own markup, and resolves with the way to open it. */
export function mountFeedbackDialog(): Promise<OpenFeedback> {
  const host = document.createElement("div");
  // A capture of the page never includes the form itself.
  host.setAttribute(CAPTURE_IGNORE_ATTRIBUTE, "");
  host.dataset.feedbackHost = "";
  document.body.appendChild(host);
  return new Promise((resolve) => {
    createRoot(host).render(<FeedbackDialog onReady={resolve} />);
  });
}
