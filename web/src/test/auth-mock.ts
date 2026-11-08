/**
 * better-auth's `api.getSession` for tests that mock `@/lib/auth`: `getSession` answers with the
 * session (or null), and this answers as better-auth does. With `returnHeaders` (the middleware,
 * through lib/auth-session.ts) that is `{ headers, response }`, with the cookies the test gives.
 */
export function sessionApi(getSession: (options: unknown) => unknown, cookies: () => readonly string[] = () => []) {
  return {
    getSession: async (options?: { returnHeaders?: boolean }) => {
      const session = await getSession(options);
      if (!options?.returnHeaders) return session;
      const headers = new Headers();
      for (const cookie of cookies()) headers.append("Set-Cookie", cookie);
      return { headers, response: session };
    },
  };
}
