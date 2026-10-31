import type { APIContext } from "astro";
import { env } from "cloudflare:workers";
import type { Me } from "../contracts";
import { getMe } from "./me";

/**
 * Page frontmatter calls getSpaceContext(Astro) directly, without self-fetching.
 * Returns the serializable Me contract. Catch and return a thrown Response for
 * flag/auth denials; page callers may render an HTML 404 instead of returning
 * the JSON response. Unexpected database failures propagate to the caller.
 */
export function getSpaceContext({ locals }: Pick<APIContext, "locals">): Promise<Me> {
  return getMe({ db: env.DB, env, locals });
}
