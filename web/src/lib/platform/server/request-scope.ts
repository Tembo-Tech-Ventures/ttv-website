/**
 * Values every helper in one read-only request shares, and that end with it (PERF-2).
 *
 * `requestCapabilities` shares capabilities through Astro.locals, but the helpers that have no locals
 * (the channel sidebar, the student journey through recordings access, search, attention, Ask) call
 * capabilitiesFor themselves, and a spaces page and its frame both read the journey and the channel
 * list. Inside a scope each such read runs once per user.
 *
 * The middleware opens a scope for GET and HEAD only: a POST, PUT, PATCH or DELETE handler may
 * change roles, applications, assignments or channels and then read them back. A scope is one Map
 * per request, held by AsyncLocalStorage and never stored anywhere else, so nothing outlives the
 * request: a revoked role or assignment applies on the very next one. Keys always include the user
 * ID, so a request that changes who is signed in reads the new person's values.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const scopes = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

const READ_METHODS: ReadonlySet<string> = new Set(["GET", "HEAD"]);

/** Runs `run` in a new scope when `method` only reads; otherwise without one. */
export function withRequestScope<T>(method: string, run: () => Promise<T>): Promise<T> {
  return READ_METHODS.has(method.toUpperCase()) ? scopes.run(new Map(), run) : run();
}

export function requestScopeActive(): boolean {
  return scopes.getStore() !== undefined;
}

/**
 * `read` once per key in this request's scope, shared by every caller, errors included; outside a
 * scope it runs on every call. Callers share the value, so they must never mutate it.
 */
export function requestScoped<T>(key: string, read: () => Promise<T>): Promise<T> {
  const scope = scopes.getStore();
  if (!scope) return read();
  let value = scope.get(key) as Promise<T> | undefined;
  if (!value) {
    value = read();
    scope.set(key, value);
  }
  return value;
}
