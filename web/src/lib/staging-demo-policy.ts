import { ROUTES } from "./platform/contracts";
import { isChannelPagePath, legacySpacePath, SPACE_PATHS, WELCOME_PATH } from "./platform/server/space-routes";

/** Retained fictional records are distinct from disposable verification fixtures. */
export const DEMO_PREFIX = 'ttv-staging-demo-v1-';
export const DEMO_PERSONAS = Object.freeze({
  'member-cohort': { userId: `${DEMO_PREFIX}member-cohort`, role: null, redirectTo: '/dashboard/community' },
  'member-noncohort': { userId: `${DEMO_PREFIX}member-noncohort`, role: null, redirectTo: '/dashboard/community' },
  mentor: { userId: `${DEMO_PREFIX}mentor`, role: 'MENTOR', redirectTo: '/dashboard/mentorship' },
  institution: { userId: `${DEMO_PREFIX}institution`, role: 'INSTITUTION', redirectTo: '/dashboard/discover' },
} as const);
for (const persona of Object.values(DEMO_PERSONAS)) Object.freeze(persona);
export type DemoPersona = keyof typeof DEMO_PERSONAS;
export const DEMO_USER_IDS = Object.freeze([
  ...Object.values(DEMO_PERSONAS).map(p => p.userId),
  ...Array.from({ length: 146 }, (_, i) => `${DEMO_PREFIX}member-${String(i + 1).padStart(3, '0')}`),
]);
const members = new Set(DEMO_USER_IDS);
export const DEMO_SESSION_MARKER = 'ttv-agent:retained-demo:';
export const DEMO_CUTOFF = Date.parse('2026-10-26T23:00:00Z') / 1000;
export const DEMO_ORIGIN = 'https://staging.tembotechventures.com';
export function isDemoUser(id: string) { return members.has(id); }
export function demoPersona(value: unknown): DemoPersona | null {
  return typeof value === 'string' && Object.hasOwn(DEMO_PERSONAS, value) ? value as DemoPersona : null;
}
export function demoEnabled(environment: string | undefined, enabled: string | undefined, origin: string, now = Date.now() / 1000) {
  return environment === 'staging' && enabled === 'true' && origin === DEMO_ORIGIN && now < DEMO_CUTOFF;
}
/**
 * Phase 1 spaces read surfaces for restricted staging identities, as exact
 * allowlist (legacy) paths. Flags, capabilities and handlers still decide access.
 * Search is absent: its handler refuses fixture and QA identities (no fixture scope).
 * The onboarding welcome step is read-only here so partner-page links work: a hint
 * redirects into a space the identity may open (or, while onboarding is off, to its
 * legacy page), and the page itself refuses agent sessions. Choosing, requesting
 * access and the onboarding APIs stay closed: retained personas have no cleanup.
 */
export const SPACES_READ_PATHS: ReadonlySet<string> = new Set([
  ROUTES.getMe.path, ROUTES.listAttention.path, ROUTES.countAttention.path, "/dashboard/attention", WELCOME_PATH,
]);
/** A channel id these allowlists accept: the seeded hex and cuid shapes. Anything else stays closed. */
const CHANNEL_API_ID = "[A-Za-z0-9_-]{1,255}";
const CHANNEL_MESSAGES_API = new RegExp(`^/api/channels/${CHANNEL_API_ID}/messages$`);
const CHANNEL_READ_API = new RegExp(`^/api/channels/${CHANNEL_API_ID}/read$`);
/**
 * GET/HEAD surfaces every restricted identity may open: the Phase 1 reads above, plus the channel
 * pages and the code of conduct (B-2.2), and the channel list and message reads those pages poll
 * (B-2.3). Only valid channel slugs and ids match. Posting, editing, reacting and agreeing to the
 * code of conduct stay closed: retained personas have no cleanup. The channels flag, the caller's
 * channel access and the handlers still decide what each one sees.
 */
export function spacesReadPathAllowed(path: string): boolean {
  return SPACES_READ_PATHS.has(path) || isChannelPagePath(path)
    || path === ROUTES.listChannels.path || CHANNEL_MESSAGES_API.test(path);
}
/** POST: the caller's own channel read marker, which fixture cleanup removes with the user (B-2.3). */
export function channelReadMarkerPath(path: string): boolean {
  return CHANNEL_READ_API.test(path);
}
/** The signed-in Apply form. GET only: no QA ledger covers a submitted application. */
export const SPACES_APPLY_PATH = legacySpacePath(`${SPACE_PATHS.cohort}/apply`);
/** Marks the caller's own attention rows read; only where cleanup removes those rows. */
export const SPACES_MARK_READ_PATH = ROUTES.markAttentionRead.path;

/** Explicit routes only. Cohort extensions require reviewing their resource ownership. */
export function demoPathAllowed(path: string, method: string) {
  const normalized = legacySpacePath(path);
  if (['/demo', '/api/demo/switch', '/api/demo/logout', '/api/demo/return'].includes(normalized)) return true;
  if (normalized === '/api/community/access') return method === 'GET';
  if (/^\/api\/community\/(profile|journey|profiles|mentorship|chat)(\/|$)/.test(normalized)) return true;
  if (!['GET', 'HEAD'].includes(method)) return false;
  if (/^\/dashboard\/application\/[^/]+$/.test(normalized)) return true;
  if (spacesReadPathAllowed(normalized) || normalized === SPACES_APPLY_PATH) return true;
  return ['', '/dashboard/sessions', '/dashboard', '/dashboard/community', '/dashboard/mentorship', '/dashboard/discover', '/community/members', '/community/mentors', '/community/institutions'].includes(normalized) || normalized.startsWith('/_astro/');
}
