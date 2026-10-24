/** Keep synthetic feedback bearer requests inside their original browser origin. */
export async function guardFeedbackBrowserContext(context, baseURL) {
  const origin = new URL(baseURL).origin;
  await context.route("**/*", async route => {
    const request = route.request();
    if (new URL(request.url()).origin !== origin || request.redirectedFrom()) {
      return route.abort();
    }
    let response;
    try {
      response = await route.fetch({ maxRedirects: 0 });
    } catch {
      // Playwright transport errors can include request headers in their call log.
      return route.abort();
    }
    if (response.status() >= 300 && response.status() < 400) return route.abort();
    return route.fulfill({ response });
  });
}

/** APIRequestContext bypasses browser routing and can include headers in errors. */
export async function feedbackApiRequest(api, baseURL, target, options = {}) {
  try {
    const base = new URL(baseURL);
    const url = new URL(target, base);
    if (base.username || base.password || url.username || url.password || url.origin !== base.origin) throw new Error();
    const response = await api.fetch(url.href, { ...options, maxRedirects: 0 });
    if (response.status() >= 300 && response.status() < 400) throw new Error();
    return response;
  } catch {
    // No original error/cause: Playwright call logs can contain bearer headers.
    throw new Error("Feedback API request failed safely.");
  }
}
