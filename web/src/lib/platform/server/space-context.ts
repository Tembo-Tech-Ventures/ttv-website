import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import type { Me } from "../contracts";
import { getMe } from "./me";

const contexts = new WeakMap<App.Locals, { user: App.Locals["user"]; token: App.Locals["personalAccessToken"]; me: Promise<Me> }>();

/**
 * Page frontmatter calls getSpaceContext(Astro) directly, without self-fetching.
 * Returns the serializable Me contract. Catch and return a thrown Response for
 * flag/auth denials; page callers may render an HTML 404 instead of returning
 * the JSON response. Unexpected database failures propagate to the caller.
 */
export function getSpaceContext({ locals }: Pick<APIContext, "locals">): Promise<Me> {
  let cached = contexts.get(locals);
  if (!cached || cached.user !== locals.user || cached.token !== locals.personalAccessToken) {
    cached = { user: locals.user, token: locals.personalAccessToken, me: getMe({ db: env.DB, env, locals }) };
    contexts.set(locals, cached);
  }
  return cached.me;
}
