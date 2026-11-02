/*
 * Progressive enhancement for /admin/moderation (U-2.4). Without JavaScript each decision is a
 * form post and a full page. With it, the same form is posted with fetch, and the queue region is
 * swapped for the one the server renders back: the banner after a decision, or the refusal beside
 * the form. So the page keeps its scroll and focus, and it can only ever show what the server
 * says. If the post never reaches the server, or the answer is not the queue (an expired session,
 * an error page), the card says nothing changed and keeps the reason as typed.
 */
import { MODERATION_PENDING_EVENT } from "./case-model";

const ROOT = "[data-moderation-root]";
const FORM = "form[data-moderation-form]";

// The post may have reached TTV before the connection dropped, so this never says nothing changed.
export const NETWORK_FAILURE = "TTV could not be reached, so this decision may not have been saved. Refresh the page to check before deciding again.";
export const SIGNED_OUT = "Nothing changed. Your session has ended. Sign in again, then decide this case.";
export const UNEXPECTED = "Nothing changed. The decision could not be saved. Try again.";
export const SAVED_UNSHOWN = "Saved. The queue could not be shown afterwards: refresh the page to see it.";

/** What a post came back as: the queue to show, a decision saved but not shown, or why nothing changed. */
export type Outcome =
  | { kind: "queue"; root: Element }
  | { kind: "saved"; message: string }
  | { kind: "failed"; message: string };

/** Read a response to a decision post. Pure apart from parsing, so the tests can drive it. */
export function readOutcome(response: { url: string; status: number }, html: string, parse: (html: string) => Document): Outcome {
  const url = new URL(response.url, "http://localhost");
  if (url.pathname.startsWith("/auth/")) return { kind: "failed", message: SIGNED_OUT };
  const root = parse(html).querySelector(ROOT);
  if (root && response.status < 500) return { kind: "queue", root };
  // The server redirects only once a decision is recorded, so a failed read after it is still a decision.
  if (url.searchParams.has("decided")) return { kind: "saved", message: SAVED_UNSHOWN };
  // A 4xx with the queue is a refusal the server explains in the card; anything else is not ours.
  return { kind: "failed", message: UNEXPECTED };
}

function showFailure(form: HTMLFormElement, message: string, { invalid = true } = {}) {
  const error = form.querySelector<HTMLElement>("[data-moderation-error]");
  if (!error) return;
  error.textContent = message;
  error.classList.remove("hidden");
  if (invalid) form.querySelector("textarea")?.setAttribute("aria-invalid", "true");
  error.focus();
}

function setBusy(form: HTMLFormElement, busy: boolean) {
  form.toggleAttribute("aria-busy", busy);
  for (const button of form.querySelectorAll<HTMLButtonElement>("button[type=submit]")) {
    if (busy) button.setAttribute("aria-disabled", "true");
    else button.removeAttribute("aria-disabled");
  }
}

const parseHtml = (html: string) => new DOMParser().parseFromString(html, "text/html");

async function submit(form: HTMLFormElement, submitter: HTMLElement | null, fetcher: typeof fetch) {
  const root = form.closest(ROOT);
  if (!root || form.hasAttribute("aria-busy")) return;
  setBusy(form, true);
  let outcome: Outcome;
  try {
    const body = new FormData(form, submitter instanceof HTMLButtonElement ? submitter : null);
    // Not form.action: the decision buttons are named "action", and a named control shadows it.
    const target = new URL(form.getAttribute("action") ?? "", document.baseURI).href;
    const response = await fetcher(target, { method: "POST", body, credentials: "same-origin", headers: { Accept: "text/html" } });
    outcome = readOutcome(response, await response.text(), parseHtml);
  } catch {
    outcome = { kind: "failed", message: NETWORK_FAILURE };
  }
  if (outcome.kind === "failed") {
    setBusy(form, false);
    showFailure(form, outcome.message);
    return;
  }
  if (outcome.kind === "saved") {
    // Recorded: the buttons stay busy, so the same case is not decided twice before a refresh.
    showFailure(form, outcome.message, { invalid: false });
    return;
  }
  const next = document.importNode(outcome.root, true);
  root.replaceWith(next);
  // The sidebar badge lives outside the queue: tell it the count the server rendered.
  const pending = Number(next.getAttribute("data-pending-count"));
  if (Number.isInteger(pending)) next.ownerDocument.dispatchEvent(new CustomEvent(MODERATION_PENDING_EVENT, { detail: pending }));
  // autofocus does not run for swapped-in content: focus what the server marked, as a load would.
  next.querySelector<HTMLElement>("[autofocus]")?.focus();
}

/** Listen once on the document, so swapped-in forms are enhanced too. Returns the way to stop. */
export function enhanceModerationQueue(doc: Document, fetcher: typeof fetch = (...args) => fetch(...args)): () => void {
  const onSubmit = (event: SubmitEvent) => {
    const form = event.target;
    if (!(form instanceof HTMLFormElement) || !form.matches(FORM)) return;
    event.preventDefault();
    void submit(form, event.submitter, fetcher);
  };
  doc.addEventListener("submit", onSubmit);
  return () => doc.removeEventListener("submit", onSubmit);
}
