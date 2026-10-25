import type { DemoAccessError, DemoPersona } from "./DemoRoleChooser";

const destinations: Record<DemoPersona, string> = {
  "member-cohort": "/dashboard/community",
  "member-noncohort": "/dashboard/community",
  mentor: "/dashboard/mentorship",
  institution: "/dashboard/discover",
};

export class DemoRequestError extends Error {
  constructor(public readonly code: DemoAccessError) {
    super("Demo action could not be completed");
  }
}

/** Fixed same-origin endpoints only; the server authorizes the operator. */
export async function requestDemoAction(persona: DemoPersona | null): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000);
  try {
    const response = await fetch(persona === null ? "/api/demo/logout" : "/api/demo/switch", {
      method: "POST",
      credentials: "same-origin",
      redirect: "error",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(persona === null ? {} : { persona }),
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new DemoRequestError(response.status === 401 ? "expired" : response.status === 403 ? "forbidden" : response.status === 409 ? "unavailable" : "failed");
    }
    if (persona === null) return "/demo";
    const data: unknown = await response.json();
    const expected = destinations[persona];
    if (!data || typeof data !== "object" || !("redirectTo" in data) || data.redirectTo !== expected) {
      throw new DemoRequestError("failed");
    }
    return expected;
  } catch (error) {
    if (error instanceof DemoRequestError) throw error;
    throw new DemoRequestError("failed");
  } finally {
    clearTimeout(timeout);
  }
}
