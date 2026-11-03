import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  drizzle: vi.fn(),
  queueSend: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({
  env: { DB: {}, RECORDING_QUEUE: { send: mocks.queueSend } },
}));
vi.mock("drizzle-orm/d1", () => ({ drizzle: mocks.drizzle }));

import { POST } from "./reindex";

function createDatabase(recording: { id: string } | undefined) {
  return {
    query: { recording: { findFirst: vi.fn().mockResolvedValue(recording) } },
  };
}

function jsonContext(body: unknown, isAdmin = true) {
  return {
    request: new Request("https://example.com/api/admin/recordings/reindex", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
    locals: { isAdmin },
  } as never;
}

function formContext(recordingId: string) {
  const formData = new FormData();
  formData.set("recordingId", recordingId);
  return {
    request: new Request("https://example.com/api/admin/recordings/reindex", {
      method: "POST",
      body: formData,
    }),
    locals: { isAdmin: true },
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.queueSend.mockResolvedValue(undefined);
});

describe("POST /api/admin/recordings/reindex", () => {
  it("rejects a non-admin before touching the database or queue", async () => {
    const response = await POST(jsonContext({ recordingId: "rec-1" }, false));

    expect(response.status).toBe(401);
    expect(mocks.drizzle).not.toHaveBeenCalled();
    expect(mocks.queueSend).not.toHaveBeenCalled();
  });

  it("requires a recording id", async () => {
    const response = await POST(jsonContext({}));

    expect(response.status).toBe(400);
    expect(mocks.queueSend).not.toHaveBeenCalled();
  });

  it("returns 404 for an unknown recording without queueing work", async () => {
    mocks.drizzle.mockReturnValue(createDatabase(undefined));

    const response = await POST(jsonContext({ recordingId: "missing" }));

    expect(response.status).toBe(404);
    expect(mocks.queueSend).not.toHaveBeenCalled();
  });

  it("queues a re-index message for a known recording", async () => {
    mocks.drizzle.mockReturnValue(createDatabase({ id: "rec-1" }));

    const response = await POST(jsonContext({ recordingId: "rec-1" }));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ success: true });
    expect(mocks.queueSend).toHaveBeenCalledWith({
      type: "reindex_recording",
      recordingId: "rec-1",
    });
  });

  it("redirects back to the recording page for a form submission", async () => {
    mocks.drizzle.mockReturnValue(createDatabase({ id: "rec-1" }));

    const response = await POST(formContext("rec-1"));

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("/admin/recordings/rec-1");
    expect(mocks.queueSend).toHaveBeenCalledWith({
      type: "reindex_recording",
      recordingId: "rec-1",
    });
  });
});
