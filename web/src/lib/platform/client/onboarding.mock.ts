import {
  CreateAccessRequest, Intent, OnboardingState, ROUTES, UpdateOnboarding,
  type AccessDecisionKind, type AccessRequestSummary, type AccessRole,
} from "../contracts";
import { onboardingByPersona } from "../fixtures";
import { createApiClient, type ApiClient } from "./apiClient";
import { createMockTransport, type MockOptions, type MockReply } from "./mockTransport";

export type OnboardingPersona = keyof typeof onboardingByPersona;
export const MOCK_DAILY_REQUEST_LIMIT = 5;

export interface OnboardingMock {
  api: ApiClient;
  /** The mock server's current truth. */
  state(): OnboardingState;
  /** Plays the administrator, so a harness can show the Approved and Declined cards. */
  decide(role: AccessRole, decision: AccessDecisionKind, message?: string): void;
}

const failure = (status: number, code: string, message: string, retryAfterMs?: number): MockReply =>
  ({ status, data: { error: { code, message, ...(retryAfterMs === undefined ? {} : { retryAfterMs }) } } });
const notFound = () => failure(404, "not_found", "Request not found.");
const order = (intents: Iterable<Intent>) => {
  const chosen = new Set(intents);
  return Intent.options.filter(intent => chosen.has(intent));
};

/**
 * A stateful, in-memory onboarding API over the shared synthetic personas, following SPEC §5: EXPLORING
 * stands alone, one PENDING request per role, at most five requests a day, a request records its intent
 * and a withdraw removes it (leaving EXPLORING when that empties a completed onboarding), only decided
 * requests can be dismissed, and an unknown id is 404 `not_found`. It mirrors B-O.2's service; that
 * service stays the authority. Nothing here grants anything outside the mock.
 * `options` passes latency and failure injection (409, 429, offline) through to the mock transport.
 */
export function createOnboardingMock(persona: OnboardingPersona = "wairimu", options: MockOptions = {}): OnboardingMock {
  let state = OnboardingState.parse(structuredClone(onboardingByPersona[persona]));
  let sequence = 0;
  let created = 0;
  const reply = (): MockReply => ({ data: OnboardingState.parse(state) });
  const replace = (request: AccessRequestSummary, intents = state.intents) => {
    state = { ...state, intents, requests: [...state.requests.filter(r => r.role !== request.role), request] };
  };
  const find = (id: string) => state.requests.find(request => request.id === id);

  const api = createApiClient({ retry: { maxRetries: 0 }, fetch: createMockTransport([
    { ...ROUTES.getOnboarding, reply },
    { ...ROUTES.updateOnboarding, reply: async ({ request }) => {
      const body = UpdateOnboarding.parse(await request.json());
      state = { ...state, stage: "DONE", intents: "intents" in body ? order(body.intents) : state.intents };
      return reply();
    } },
    { ...ROUTES.createAccessRequest, reply: async ({ request }) => {
      const body = CreateAccessRequest.parse(await request.json());
      const existing = state.requests.find(r => r.role === body.role);
      if (state.roles.includes(body.role) || existing?.status === "PENDING") {
        return failure(409, "conflict", "There is already a request or access for this role.");
      }
      if (created >= MOCK_DAILY_REQUEST_LIMIT) return failure(429, "rate_limited", "Too many requests today.", 3_600_000);
      created++;
      const now = Date.now();
      replace({
        id: `mock-access-request-${++sequence}`, role: body.role, status: "PENDING", note: body.note,
        organisation: body.role === "INSTITUTION" ? body.organisation : null,
        organisationRole: body.role === "INSTITUTION" ? body.organisationRole : null,
        link: body.link, decisionMessage: null, createdAt: now, updatedAt: now, decidedAt: null, seenAt: null,
      }, order([...state.intents.filter(intent => intent !== "EXPLORING"), body.role]));
      return reply();
    } },
    { ...ROUTES.withdrawAccessRequest, reply: ({ params }) => {
      const request = find(params.id);
      if (!request) return notFound();
      if (request.status !== "PENDING") return failure(409, "conflict", "Only pending requests can do that.");
      const intents = state.intents.filter(intent => intent !== request.role);
      replace({ ...request, status: "WITHDRAWN", updatedAt: Date.now() },
        intents.length === 0 && state.stage === "DONE" ? ["EXPLORING"] : intents);
      return reply();
    } },
    { ...ROUTES.dismissAccessRequest, reply: ({ params }) => {
      const request = find(params.id);
      if (!request) return notFound();
      if (request.status !== "APPROVED" && request.status !== "DECLINED") {
        return failure(409, "conflict", "Only approved or declined requests can do that.");
      }
      replace({ ...request, seenAt: request.seenAt ?? Date.now() });
      return reply();
    } },
  ], options) });

  return {
    api,
    state: () => OnboardingState.parse(state),
    decide(role, decision, message) {
      const request = state.requests.find(r => r.role === role && r.status === "PENDING");
      if (!request) throw new Error(`No pending ${role} request to decide`);
      const now = Date.now();
      replace({
        ...request, status: decision === "approve" ? "APPROVED" : "DECLINED",
        decisionMessage: message ?? null, decidedAt: now, updatedAt: now,
      });
      if (decision === "approve") state = { ...state, roles: [...state.roles, role] };
    },
  };
}
