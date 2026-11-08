type SignOut = (options: { headers: Headers; asResponse: true }) => Promise<Response>;

/**
 * Sign the session out and send the browser home with a 303, so the POST that asked for it is never
 * replayed. Each cookie is copied on its own: Expires attributes can contain commas. Returns null when
 * better-auth could not sign out, so the page can say so without claiming success.
 */
export async function logoutResponse(headers: Headers, signOut: SignOut): Promise<Response | null> {
  try {
    const result = await signOut({ headers, asResponse: true });
    if (!result.ok) return null;
    const outgoing = new Headers({ Location: "/", "Cache-Control": "no-store" });
    for (const cookie of result.headers.getSetCookie()) outgoing.append("Set-Cookie", cookie);
    return new Response(null, { status: 303, headers: outgoing });
  } catch {
    return null;
  }
}
