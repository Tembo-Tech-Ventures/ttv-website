/**
 * The bare responses the session scheduling pages return instead of rendering: not found (the flag is
 * off, or not a session or cohort this person hosts or sees, whatever the reason), or a method the page
 * doesn't take. Never cached: whether these pages exist depends on the person and the flags.
 */
const PRIVATE = { "Cache-Control": "no-store", Vary: "Cookie" } as const;

export function sessionPageResponse(status: 404 | 405): Response {
  return new Response(status === 404 ? "Not found." : "Not allowed.", {
    status,
    headers: { ...PRIVATE, "Content-Type": "text/plain; charset=utf-8", ...(status === 405 ? { Allow: "GET, HEAD, POST" } : {}) },
  });
}
