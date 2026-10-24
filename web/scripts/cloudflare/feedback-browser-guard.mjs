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
