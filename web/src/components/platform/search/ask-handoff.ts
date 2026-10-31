/**
 * Handing a search to Ask Tembo, the private cohort assistant.
 *
 * The words travel in the URL fragment of the Ask page: the browser keeps a
 * fragment out of requests (and so out of server logs), and the Ask composer
 * takes it once, puts it in the box and removes it from the address. Nothing
 * is sent until the person sends it, nothing is stored, and no channel
 * endpoint is involved.
 *
 * Search exists only while the spaces flag is on, so it links straight to the
 * canonical Ask route (B-1.2); the server still decides who may open it.
 */
export const ASK_TEMBO_PATH = "/dashboard/cohort/ask";
/** The search query's own limit (SearchQuery.q), restated so the chat bundle does not pull in the contracts. */
const MAX_DRAFT = 500;
const FRAGMENT = "#ask-tembo=";

export function askTemboHref(q: string): string {
  return `${ASK_TEMBO_PATH}${FRAGMENT}${encodeURIComponent(q)}`;
}

/**
 * Takes a handed-over draft from the address, once: it is removed from the URL
 * (and so from history) as it is read. Anything that is not a valid search
 * query is ignored.
 */
export function takeAskTemboDraft(location: Location = window.location, history: History = window.history): string | null {
  const hash = location.hash;
  if (!hash.startsWith(FRAGMENT)) return null;
  history.replaceState(history.state, "", location.pathname + location.search);
  let raw: string;
  try {
    raw = decodeURIComponent(hash.slice(FRAGMENT.length));
  } catch {
    return null;
  }
  const draft = raw.trim();
  return draft.length > 0 && draft.length <= MAX_DRAFT ? draft : null;
}
