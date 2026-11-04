import type { SamClaims } from "./oidc";

/** The Worker variables that switch SAM login on. Production never receives them (scripts/cloudflare/lib.mjs). */
export interface SamLoginEnvironment {
  DEPLOYMENT_ENVIRONMENT?: string;
  BETTER_AUTH_URL?: string;
  SAM_LOGIN_PROJECT_ID?: string;
  SAM_LOGIN_USER_IDS?: string;
}

export interface SamLoginConfig {
  /** The site's own origin: the only audience a token may name. */
  origin: string;
  projectId: string;
  userIds: ReadonlySet<string>;
}

const SAM_ID = /^[A-Za-z0-9_-]{1,64}$/;
const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

/**
 * SAM login is on only on staging, and only when both the SAM project and the SAM users allowed
 * to use it are configured. Anything else, including any production deployment, is off.
 */
export function samLoginConfig(env: SamLoginEnvironment): SamLoginConfig | null {
  if (env.DEPLOYMENT_ENVIRONMENT !== "staging") return null;
  const projectId = env.SAM_LOGIN_PROJECT_ID?.trim() ?? "";
  const userIds = (env.SAM_LOGIN_USER_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  if (!SAM_ID.test(projectId) || userIds.length === 0 || !userIds.every((id) => SAM_ID.test(id))) return null;
  let url: URL;
  try {
    url = new URL(env.BETTER_AUTH_URL ?? "");
  } catch {
    return null;
  }
  // Plain http only for a local staging-mode build; a deployed site is always https.
  if (url.protocol !== "https:" && !(url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname))) return null;
  return { origin: url.origin, projectId, userIds: new Set(userIds) };
}

/** A verified token is authorized only for the configured project and one of its allowed users. */
export function samLoginAuthorized(config: SamLoginConfig, owner: Pick<SamClaims, "projectId" | "userId">): boolean {
  return owner.projectId === config.projectId && config.userIds.has(owner.userId);
}
