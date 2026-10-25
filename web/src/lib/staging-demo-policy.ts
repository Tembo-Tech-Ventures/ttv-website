/** Retained fictional records are distinct from disposable verification fixtures. */
export const DEMO_PREFIX = 'ttv-staging-demo-v1-';
export const DEMO_PERSONAS = {
  'member-cohort': { userId: `${DEMO_PREFIX}member-cohort`, role: 'STUDENT', redirectTo: '/dashboard/community' },
  'member-noncohort': { userId: `${DEMO_PREFIX}member-noncohort`, role: null, redirectTo: '/dashboard/community' },
  mentor: { userId: `${DEMO_PREFIX}mentor`, role: 'MENTOR', redirectTo: '/dashboard/mentorship' },
  institution: { userId: `${DEMO_PREFIX}institution`, role: 'INSTITUTION', redirectTo: '/dashboard/discover' },
} as const;
export type DemoPersona = keyof typeof DEMO_PERSONAS;
export const DEMO_USER_IDS = Object.freeze([
  ...Object.values(DEMO_PERSONAS).map(p => p.userId),
  ...Array.from({ length: 146 }, (_, i) => `${DEMO_PREFIX}member-${String(i + 1).padStart(3, '0')}`),
]);
const members = new Set(DEMO_USER_IDS);
export const DEMO_SESSION_MARKER = 'ttv-agent:retained-demo:';
export const DEMO_CUTOFF = Date.parse('2026-10-25T23:00:00Z') / 1000;
export const DEMO_ORIGIN = 'https://staging.tembotechventures.com';
export function isDemoUser(id: string) { return members.has(id); }
export function demoPersona(value: unknown): DemoPersona | null {
  return typeof value === 'string' && Object.hasOwn(DEMO_PERSONAS, value) ? value as DemoPersona : null;
}
export function demoEnabled(environment: string | undefined, enabled: string | undefined, origin: string, now = Date.now() / 1000) {
  return environment === 'staging' && enabled === 'true' && origin === DEMO_ORIGIN && now < DEMO_CUTOFF;
}
/** Explicit routes only. Cohort extensions require reviewing their resource ownership. */
export function demoPathAllowed(path: string, method: string) {
  const normalized = path.replace(/\/$/, '');
  if (['/demo', '/api/demo/switch', '/api/demo/logout'].includes(normalized)) return true;
  if (normalized === '/api/community/access') return method === 'GET';
  if (/^\/api\/community\/(profile|journey|profiles|mentorship|chat)(\/|$)/.test(normalized)) return true;
  if (!['GET', 'HEAD'].includes(method)) return false;
  if (/^\/dashboard\/application\/[^/]+$/.test(normalized)) return true;
  return ['', '/dashboard/sessions', '/dashboard', '/dashboard/community', '/dashboard/mentorship', '/dashboard/discover', '/community/members', '/community/mentors', '/community/institutions'].includes(normalized) || normalized.startsWith('/_astro/');
}
