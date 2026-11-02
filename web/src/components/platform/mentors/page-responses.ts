/**
 * The bare responses the mentor pages return instead of rendering: not found
 * (the flag is off, or not this person's page), a refused form, or the
 * redirect after one. Never cached: whether these pages exist depends on the
 * person and the flags.
 */
const PRIVATE = { "Cache-Control": "no-store", Vary: "Cookie" } as const;

const REASON: Record<number, string> = {
  400: "That form could not be read.",
  403: "That request was refused.",
  404: "Not found.",
  405: "Not allowed.",
  413: "That form was too large.",
};

export function mentorPageResponse(status: number, headers: Record<string, string> = {}): Response {
  const reason = REASON[status];
  return new Response(reason ?? null, {
    status,
    headers: {
      ...PRIVATE,
      ...(reason ? { "Content-Type": "text/plain; charset=utf-8" } : {}),
      ...(status === 405 ? { Allow: "GET, HEAD, POST" } : {}),
      ...headers,
    },
  });
}
