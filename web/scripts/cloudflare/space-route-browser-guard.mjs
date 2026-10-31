/** Inspect route redirects without ever forwarding the delivery credential. */
export async function spaceRouteRequest(api, baseURL, target, options = {}) {
  try {
    const base = new URL(baseURL);
    const url = new URL(target, base);
    if (base.username || base.password || url.username || url.password || url.origin !== base.origin) throw new Error();
    // Unlike the feedback helper, callers need the original 301 for assertions.
    // It is returned for inspection only; Playwright must never follow it.
    return await api.fetch(url.href, { ...options, maxRedirects: 0 });
  } catch {
    // Playwright's original error/cause can include bearer request headers.
    throw new Error("Space route request failed safely.");
  }
}
