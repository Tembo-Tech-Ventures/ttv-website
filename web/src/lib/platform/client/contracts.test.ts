import { expect, expectTypeOf, it, vi } from "vitest";
import { ROUTES, type RouteDef as SharedRouteDef, type MentorDirectory, type MessageList, type Message } from "../contracts";
import * as fixtures from "../fixtures";
import { createApiClient } from "./apiClient";
import { createMockTransport } from "./mockTransport";
import type { RouteDef } from "./route";

it("uses the shared route type without a separate structural definition", () => {
  expectTypeOf<RouteDef<string, boolean, { clientNonce: string }, number>>()
    .toEqualTypeOf<SharedRouteDef<string, boolean, { clientNonce: string }, number>>();
});

it("encodes the real mentor route's false query and validates shared synthetic fixtures", async () => {
  const reply = vi.fn((_context: { request: Request }) => ({ data: fixtures.mentors }));
  const api = createApiClient({ fetch: createMockTransport([{ method: "GET", path: ROUTES.listMentors.path, reply }]) });
  const data = await api.call(ROUTES.listMentors, { query: { available: false } });
  expectTypeOf(data).toEqualTypeOf<MentorDirectory>();
  expect(data).toEqual(fixtures.mentors);
  expect(new URL(reply.mock.calls[0][0].request.url).searchParams.get("available")).toBe("false");
});

it("preserves message polling tombstones and opaque ids from the shared contract", async () => {
  const api = createApiClient({ fetch: createMockTransport([{ method: "GET", path: ROUTES.listMessages.path,
    reply: ({ request }) => ({ data: new URL(request.url).searchParams.has("since") ? fixtures.hiddenMessageDelta : fixtures.communityMessages }),
  }]) });
  const data = await api.call(ROUTES.listMessages, { params: { id: "legacy-channel-1" }, query: {} });
  expectTypeOf(data).toEqualTypeOf<MessageList>();
  expect(data).toEqual(fixtures.communityMessages);
  const removed = await api.call(ROUTES.listMessages, { params: { id: "legacy-channel-1" }, query: { since: data.sinceCursor } });
  expect(removed).toEqual(fixtures.hiddenMessageDelta);
  expect(removed.removedIds).toContain(fixtures.messages.hidden.id);
});

it("round-trips the real post route's nonce through a fixture handler", async () => {
  const nonce = "synthetic-client-nonce";
  const api = createApiClient({ fetch: createMockTransport([{ method: "POST", path: ROUTES.postMessage.path,
    reply: async ({ request }) => {
      const body: unknown = await request.json();
      expect(body).toMatchObject({ clientNonce: nonce, body: "A synthetic message" });
      return { data: { ...fixtures.messages.projectPost, clientNonce: nonce } };
    },
  }]) });
  const data = await api.call(ROUTES.postMessage, { params: { id: fixtures.channels.showYourWork.id },
    body: { body: "A synthetic message", clientNonce: nonce, parentId: null, embeds: [] } });
  expectTypeOf(data).toEqualTypeOf<Message>();
  expect(data.clientNonce).toBe(nonce);
});
