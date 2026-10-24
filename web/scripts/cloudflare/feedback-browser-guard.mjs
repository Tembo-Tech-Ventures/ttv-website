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

/** Exercise a form save without letting the browser forward a redirect. */
export async function submitFeedbackAdminSave(page, baseURL, submit) {
  const current = new URL(page.url());
  const base = new URL(baseURL);
  if (base.username || base.password || current.origin !== base.origin || current.username || current.password ||
      !/^\/admin\/feedback\/(?:themes\/)?[^/]+$/.test(current.pathname)) {
    throw new Error("Feedback save requires an exact admin page.");
  }
  const receipt = new URL(current.pathname, base.origin);
  receipt.search = "?saved=1";
  let accepted = false;
  const match = url => url.href === current.href;
  const handler = async route => {
    const request = route.request();
    if (request.method() !== "POST") return route.fallback();
    try {
      if (!request.isNavigationRequest() || request.redirectedFrom()) throw new Error();
      const response = await route.fetch({ maxRedirects: 0 });
      const location = response.headers().location;
      accepted = [302, 303].includes(response.status()) && Boolean(location) &&
        new URL(location, current).href === receipt.href;
      // No Location header or upstream body reaches the browser. The test
      // explicitly navigates only after validating the expected receipt URL.
      await route.fulfill({ status: accepted ? 200 : 400, contentType: "text/html", body: "<!doctype html><title>Save response</title>" });
    } catch {
      accepted = false;
      await route.abort();
    }
  };
  try {
    try {
      await page.route(match, handler);
      await submit();
      if (!accepted) throw new Error();
      await page.goto(receipt.href);
    } finally {
      await page.unroute(match, handler);
    }
  } catch {
    throw new Error("Feedback save failed safely; receipt was not validated.");
  }
}
