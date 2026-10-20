import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN,
  PNG_BYTES,
  STUDENT,
  createFeedbackTestDb,
  createMemoryBucket,
  imageFile,
} from "@/test/feedback-db";
import { submitFeedback } from "@/lib/feedback/submit";

const mocks = vi.hoisted(() => ({ env: {} as Record<string, unknown> }));
vi.mock("cloudflare:workers", () => ({ env: mocks.env }));

import { GET as list } from "@/pages/api/admin/feedback/index";
import { GET as detail, PATCH } from "@/pages/api/admin/feedback/[id]";

const ORIGIN = "https://tembotechventures.com";
let setup: ReturnType<typeof createFeedbackTestDb>;

beforeEach(async () => {
  setup = createFeedbackTestDb();
  Object.assign(mocks.env, { DB: setup.db });
  let next = 0;
  const newId = () => `id-${(next += 1)}`;
  const bucket = createMemoryBucket();
  const send = (kind: string, message: string, minutes: number, files: File[] = []) => {
    const formData = new FormData();
    formData.set("kind", kind);
    formData.set("message", message);
    formData.set("pageUrl", `${ORIGIN}/dashboard/apply`);
    for (const file of files) formData.append("attachments", file);
    return submitFeedback(
      { formData, userId: STUDENT.id, requestUrl: `${ORIGIN}/api/feedback` },
      {
        db: setup.db,
        bucket,
        newId,
        now: new Date(Date.UTC(2026, 9, 20, 12, minutes)),
      }
    );
  };
  await send("BUG", "Apply button does nothing", 0, [imageFile(PNG_BYTES)]);
  await send("IDEA", "Dark mode", 1);
});

function context({
  path,
  isAdmin = true,
  method = "GET",
  body,
  id,
}: {
  path: string;
  isAdmin?: boolean;
  method?: string;
  body?: string;
  id?: string;
}) {
  const url = new URL(path, ORIGIN);
  return {
    url,
    params: { id },
    request: new Request(url, { method, body }),
    locals: { isAdmin, user: isAdmin ? ADMIN : STUDENT },
  } as unknown as Parameters<typeof list>[0];
}

describe("GET /api/admin/feedback", () => {
  it("is admin-only", async () => {
    expect((await list(context({ path: "/api/admin/feedback", isAdmin: false }))).status).toBe(403);
  });

  it("returns the open queue with counts, absolute links and no student email", async () => {
    const response = await list(context({ path: "/api/admin/feedback" }));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      counts: Record<string, number>;
      items: Array<Record<string, unknown>>;
    };

    expect(body.counts).toEqual({ NEW: 2, IN_PROGRESS: 0, RESOLVED: 0, DECLINED: 0 });
    expect(body.items.map((item) => item.message)).toEqual(["Dark mode", "Apply button does nothing"]);
    expect(body.items[1]).toMatchObject({
      id: "id-1",
      kind: "BUG",
      status: "NEW",
      page: { url: `${ORIGIN}/dashboard/apply`, title: null },
      submittedBy: { id: STUDENT.id, name: STUDENT.name },
      adminUrl: `${ORIGIN}/admin/feedback/id-1`,
      attachments: [
        {
          id: "id-2",
          url: `${ORIGIN}/api/feedback/attachments/id-2`,
          contentType: "image/png",
          size: PNG_BYTES.byteLength,
          source: "UPLOAD",
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain(STUDENT.email);
  });

  it("filters by status and kind and rejects unknown values", async () => {
    const bugs = await list(context({ path: "/api/admin/feedback?status=all&kind=bug" }));
    expect(((await bugs.json()) as { items: unknown[] }).items).toHaveLength(1);

    const resolved = await list(context({ path: "/api/admin/feedback?status=RESOLVED" }));
    expect(((await resolved.json()) as { items: unknown[] }).items).toHaveLength(0);

    expect((await list(context({ path: "/api/admin/feedback?status=done" }))).status).toBe(400);
    expect((await list(context({ path: "/api/admin/feedback?kind=rant" }))).status).toBe(400);
  });
});

describe("/api/admin/feedback/[id]", () => {
  it("returns one item or 404", async () => {
    const found = await detail(context({ path: "/api/admin/feedback/id-1", id: "id-1" }));
    expect(found.status).toBe(200);
    expect(((await found.json()) as { id: string }).id).toBe("id-1");

    const missing = await detail(context({ path: "/api/admin/feedback/x", id: "x" }));
    expect(missing.status).toBe(404);
    expect((await detail(context({ path: "/x", id: "id-1", isAdmin: false }))).status).toBe(403);
  });

  it("claims, resolves and replies, recording the actor", async () => {
    const patch = (body: unknown) =>
      PATCH(
        context({
          path: "/api/admin/feedback/id-1",
          id: "id-1",
          method: "PATCH",
          body: JSON.stringify(body),
        })
      );

    const claimed = await patch({ status: "IN_PROGRESS", expectedStatus: "NEW", adminNote: "Agent run 42" });
    expect(claimed.status).toBe(200);

    const conflict = await patch({ status: "IN_PROGRESS", expectedStatus: "NEW" });
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({
      error: "Feedback is IN_PROGRESS, not NEW.",
      feedback: { status: "IN_PROGRESS" },
    });

    const resolved = await patch({
      status: "RESOLVED",
      response: "Fixed. Thanks for flagging it!",
      resolutionUrl: "https://github.com/Tembo-Tech-Ventures/ttv-website/pull/200",
    });
    expect(resolved.status).toBe(200);
    expect(await resolved.json()).toMatchObject({
      status: "RESOLVED",
      response: "Fixed. Thanks for flagging it!",
      adminNote: "Agent run 42",
      handledBy: { id: ADMIN.id, name: ADMIN.name },
    });
  });

  it("rejects bad bodies", async () => {
    const send = (body: string) =>
      PATCH(context({ path: "/api/admin/feedback/id-1", id: "id-1", method: "PATCH", body }));

    expect((await send("{")).status).toBe(400);
    expect(await (await send(JSON.stringify({ status: "DONE" }))).json()).toEqual({
      error: "Unknown status.",
    });
    expect(await (await send(JSON.stringify({ priority: 1 }))).json()).toEqual({
      error: "Unknown field: priority.",
    });
    expect((await send(JSON.stringify({}))).status).toBe(400);
    expect(
      (await PATCH(context({ path: "/x", id: "missing", method: "PATCH", body: '{"status":"NEW"}' })))
        .status
    ).toBe(404);
    expect(
      (await PATCH(context({ path: "/x", id: "id-1", method: "PATCH", isAdmin: false, body: "{}" })))
        .status
    ).toBe(403);
  });
});
