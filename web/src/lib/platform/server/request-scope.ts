/**
 * PERF-1 cheap wins (prototype, not merged): values shared by every helper in
 * one request, and dropped with it.
 *
 * Today `requestCapabilities` shares capabilities through Astro.locals, but the
 * helpers that do not have locals (the student journey, recordings access, the
 * channel sidebar, search) call capabilitiesFor themselves: three identical
 * lookups on a spaces page. Inside a scope, capabilitiesFor is computed once per
 * user per request. Nothing outlives the request, so a revoked role or
 * assignment still applies on the very next one, as before.
 *
 * Scopes are opened for GET and HEAD only: a POST may change roles or
 * applications and then read them back.
 */
import { AsyncLocalStorage } from "node:async_hooks";

const scopes = new AsyncLocalStorage<Map<string, Promise<unknown>>>();

export function withRequestScope<T>(run: () => Promise<T>): Promise<T> {
  return scopes.run(new Map(), run);
}

export function requestScopeActive(): boolean {
  return scopes.getStore() !== undefined;
}

/** `compute` once per key in this request's scope; outside a scope, every call computes. */
export function requestScoped<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const scope = scopes.getStore();
  if (!scope) return compute();
  let value = scope.get(key) as Promise<T> | undefined;
  if (!value) {
    value = compute();
    scope.set(key, value);
  }
  return value;
}
