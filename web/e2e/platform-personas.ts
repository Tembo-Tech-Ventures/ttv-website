import { createHmac } from "node:crypto";
import type { BrowserContext } from "@playwright/test";
import {
  deriveAgentPreviewAuthSecret,
  isAgentEnvironmentName,
} from "../scripts/cloudflare/agent-preview-auth.mjs";

/**
 * The people the spaces pages are checked as, and how a browser signs in as
 * each of them.
 *
 * They sign in with a cookie, the way a real browser does. Bearer headers do
 * not work for this: the community API refuses bearer sessions that are not
 * scoped personal access tokens (lib/community/http.ts), so a bearer-header
 * "community member" never sees their workspace. The cookie is Better Auth's
 * own signed session cookie for a session that already exists:
 *
 * - On an isolated agent preview, the runner already holds the preview's
 *   persona session tokens and the secret both the tokens and the preview's
 *   auth secret derive from. Nothing new is granted, and nothing works
 *   anywhere but that preview.
 * - Locally, `platform-personas.local.sql` seeds fictional people into the
 *   local D1 and PLATFORM_PERSONAS_LOCAL_SECRET is the dev server's
 *   BETTER_AUTH_SECRET from .dev.vars.
 *
 * The preview has no mentor entry yet, so the mentor is checked locally only
 * (see PREVIEW_TOKENS).
 */

/** Only the variables these helpers read. */
type Environment = Readonly<Record<string, string | undefined>>;

export type PersonaKey = "student" | "alumna" | "mentor" | "community" | "institution" | "staff";

export interface PersonaExpectation {
  /**
   * Where /dashboard opens with no preference saved. These runs have every flag on, so onboarding's
   * inferred intents choose: a mentor opens Mentoring and an institution Discover (onboarding SPEC §3).
   */
  landing: string;
  /** The space tabs, in order. */
  spaces: string[];
}

export const PERSONA_EXPECTATIONS: Record<PersonaKey, PersonaExpectation> = {
  student: { landing: "/dashboard/cohort", spaces: ["Cohort", "Community", "Profile"] },
  alumna: { landing: "/dashboard/cohort", spaces: ["Cohort", "Community", "Profile"] },
  mentor: { landing: "/dashboard/mentoring", spaces: ["Community", "Mentoring", "Profile"] },
  community: { landing: "/dashboard/community", spaces: ["Community", "Profile"] },
  institution: { landing: "/dashboard/discover", spaces: ["Community", "Discover", "Profile"] },
  staff: { landing: "/dashboard/cohort", spaces: ["Cohort", "Community", "Discover", "Admin", "Profile"] },
};

export interface PersonaSession {
  key: PersonaKey;
  token: string;
  secret: string;
}

const PREVIEW_TOKENS: Partial<Record<PersonaKey, string>> = {
  student: "PLAYWRIGHT_ACCEPTED_STUDENT_TOKEN",
  alumna: "PLAYWRIGHT_GRADUATE_STUDENT_TOKEN",
  community: "PLAYWRIGHT_NEW_STUDENT_TOKEN",
  // The preview mentor (PLAYWRIGHT_MENTOR_TOKEN) is not listed yet. Its
  // session carries the delegated ttv-agent: marker, and the mentor review
  // API refuses delegated sessions (requireBrowser in lib/community/http.ts),
  // so its confirm page is checked against the local seed. Its spaces and
  // route access are checked live in preview-role-personas.spec.ts.
  institution: "PLAYWRIGHT_INSTITUTION_TOKEN",
  staff: "PLAYWRIGHT_AGENT_TOKEN",
};

/** The session to sign in as, or why there is none in this environment. */
export function personaSession(key: PersonaKey, environment: Environment = process.env): PersonaSession | string {
  if (!environment.PLAYWRIGHT_BASE_URL) {
    const secret = environment.PLATFORM_PERSONAS_LOCAL_SECRET;
    if (!secret) return "Set PLATFORM_PERSONAS_LOCAL_SECRET and apply platform-personas.local.sql to run locally.";
    return { key, token: `ttv-local-persona-${key}-token`, secret };
  }
  const name = environment.EXPECTED_DEPLOYMENT_ENVIRONMENT ?? "";
  const previewSecret = environment.AGENT_PREVIEW_SECRET?.trim();
  if (!isAgentEnvironmentName(name) || !previewSecret) return "Persona sessions exist only on isolated agent previews.";
  const variable = PREVIEW_TOKENS[key];
  if (!variable) return `Agent previews have no ${key} persona yet; it is checked against the local seed.`;
  const token = environment[variable]?.trim();
  if (!token) return `${variable} is not set for this run.`;
  if (token.startsWith("ttv_pat_")) return "A personal access token is not a browser session.";
  return { key, token, secret: deriveAgentPreviewAuthSecret(previewSecret, name) };
}

/**
 * Sessions are minted only for this machine or the isolated agent preview the
 * run deployed: `https://<app>-<agent-environment>.<account>.workers.dev`.
 * Anything else (staging, production, a custom domain) is refused.
 */
export function assertPersonaOrigin(baseURL: string, environment: Environment = process.env): void {
  const { hostname, protocol } = new URL(baseURL);
  if (["localhost", "127.0.0.1"].includes(hostname) && !environment.PLAYWRIGHT_BASE_URL) return;
  const name = environment.EXPECTED_DEPLOYMENT_ENVIRONMENT ?? "";
  const [worker = "", ...rest] = hostname.split(".");
  const preview = protocol === "https:" && isAgentEnvironmentName(name) && worker.endsWith(`-${name}`)
    && rest.length === 3 && rest.slice(-2).join(".") === "workers.dev";
  if (!preview) throw new Error("Persona sessions are only minted for localhost or this run's isolated agent preview.");
}

/** Better Auth's signed session cookie (better-call signCookieValue), for a session that already exists. */
export async function signIn(context: BrowserContext, baseURL: string, session: PersonaSession): Promise<void> {
  assertPersonaOrigin(baseURL);
  const secure = new URL(baseURL).protocol === "https:";
  const signature = createHmac("sha256", session.secret).update(session.token).digest("base64");
  await context.addCookies([{
    name: `${secure ? "__Secure-" : ""}better-auth.session_token`,
    value: encodeURIComponent(`${session.token}.${signature}`),
    url: baseURL,
    httpOnly: true,
    secure,
    sameSite: "Lax",
  }]);
}
