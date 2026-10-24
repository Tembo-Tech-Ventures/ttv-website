type SignOut = (options: { headers: Headers; asResponse: true }) => Promise<Response>;

/** Preserve each cookie independently: Expires attributes can contain commas. */
export async function logoutResponse(headers: Headers, signOut: SignOut): Promise<Response> {
  try {
    const result = await signOut({ headers, asResponse: true });
    if (!result.ok) throw new Error("Sign out failed");
    const outgoing = new Headers({ Location: "/", "Cache-Control": "no-store" });
    for (const cookie of result.headers.getSetCookie()) outgoing.append("Set-Cookie", cookie);
    return new Response(null, { status: 302, headers: outgoing });
  } catch {
    return new Response("Unable to sign out. Please try again.", {
      status: 503,
      headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
