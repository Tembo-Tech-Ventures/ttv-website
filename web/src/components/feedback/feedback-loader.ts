import { OPEN_FEEDBACK_ATTRIBUTE, OPEN_FEEDBACK_EVENT, takeFeedbackRequest } from "./feedback-client";

/** Opens the mounted form, handing it the control that asked so focus can go back there. */
export type OpenFeedback = (trigger: HTMLElement | null) => void;

type LoadDialog = () => Promise<{ mountFeedbackDialog: () => Promise<OpenFeedback> }>;

/**
 * Where the feedback form comes from: the dialog and everything it needs
 * (React's renderer included, on pages with no other island) load only when
 * someone asks for it, not on every page. Until then the page carries this
 * listener and a server-rendered button.
 *
 * A request is a press on anything marked `data-open-feedback` (the launcher,
 * the feedback page's own button) or `openFeedbackWidget()` from an island's
 * menu. A request made before this ran is left on `window` and taken here.
 * Requests while the form loads all open the one form; it is mounted once.
 */
export function installFeedbackLoader(load: LoadDialog = () => import("./mount-feedback")): () => void {
  let opener: Promise<OpenFeedback> | null = null;

  const request = (trigger: HTMLElement | null) => {
    takeFeedbackRequest();
    opener ??= load().then((module) => module.mountFeedbackDialog());
    opener.then((open) => open(trigger)).catch(() => {
      // A failed load (offline, a new deploy) may be retried by the next press.
      opener = null;
    });
  };
  const focused = () => (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  const onRequest = () => request(focused());
  const onClick = (event: MouseEvent) => {
    const trigger = event.target instanceof Element ? event.target.closest<HTMLElement>(`[${OPEN_FEEDBACK_ATTRIBUTE}]`) : null;
    if (trigger) request(trigger);
  };

  window.addEventListener(OPEN_FEEDBACK_EVENT, onRequest);
  document.addEventListener("click", onClick);
  if (takeFeedbackRequest()) request(focused());

  return () => {
    window.removeEventListener(OPEN_FEEDBACK_EVENT, onRequest);
    document.removeEventListener("click", onClick);
  };
}
