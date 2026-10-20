import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ADMIN,
  OTHER_STUDENT,
  PNG_BYTES,
  STUDENT,
  createFeedbackTestDb,
  createMemoryBucket,
  imageFile,
} from "@/test/feedback-db";

const mocks = vi.hoisted(() => ({
  env: {} as Record<string, unknown>,
}));

vi.mock("cloudflare:workers", () => ({ env: mocks.env }));

import { POST } from "@/pages/api/feedback/index";
import { GET as getAttachment } from "@/pages/api/feedback/attachments/[id]";

const ORIGIN = "https://tembotechventures.com";
let setup: ReturnType<typeof createFeedbackTestDb>;
let bucket: ReturnType<typeof createMemoryBucket>;

beforeEach(() => {
  setup = createFeedbackTestDb();
  bucket = createMemoryBucket();
  Object.assign(mocks.env, {
    DB: setup.db,
    BUCKET: bucket,
    DEPLOYMENT_VERSION: "deadbeef",
  });
});

function postContext({
  user = STUDENT as { id: string } | null,
  origin = ORIGIN as string | null,
  body = new FormData() as FormData | string,
} = {}) {
  const headers = new Headers();
  if (origin) headers.set("Origin", origin);
  const request = new Request(`${ORIGIN}/api/feedback`, {
    method: "POST",
    headers,
    body,
  });
  return { request, locals: { user } } as unknown as Parameters<typeof POST>[0];
}

function feedbackForm(fields: Record<string, string>, files: File[] = []) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(fields)) formData.set(key, value);
  for (const file of files) formData.append("attachments", file);
  return formData;
}

async function submitAs(userId: string) {
  const response = await POST(
    postContext({
      user: { id: userId },
      body: feedbackForm(
        { kind: "BUG", message: "Broken", pageUrl: `${ORIGIN}/dashboard` },
        [imageFile(PNG_BYTES)]
      ),
    })
  );
  const { id } = (await response.json()) as { id: string };
  const attachmentId = setup.database
    .prepare(`SELECT "id" FROM "feedback_attachment" WHERE "feedbackId" = ?`)
    .get(id) as { id: string };
  return { id, attachmentId: attachmentId.id };
}

describe("POST /api/feedback", () => {
  it("requires a signed-in user", async () => {
    const response = await POST(postContext({ user: null }));
    expect(response.status).toBe(401);
  });

  it("refuses cross-site and origin-less submissions", async () => {
    expect((await POST(postContext({ origin: "https://evil.example" }))).status).toBe(403);
    expect((await POST(postContext({ origin: null }))).status).toBe(403);
    expect(bucket.put).not.toHaveBeenCalled();
  });

  it("stores a note with the deployed version and returns its id", async () => {
    const response = await POST(
      postContext({
        body: feedbackForm(
          { kind: "IDEA", message: "Dark mode please", pageUrl: `${ORIGIN}/dashboard` },
          [imageFile(PNG_BYTES)]
        ),
      })
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const { id } = (await response.json()) as { id: string };
    const row = setup.database
      .prepare(`SELECT "userId", "kind", "appVersion" FROM "feedback" WHERE "id" = ?`)
      .get(id);
    expect({ ...row }).toEqual({ userId: STUDENT.id, kind: "IDEA", appVersion: "deadbeef" });
    expect(bucket.objects.size).toBe(1);
  });

  it("reports validation problems in words a student can act on", async () => {
    const response = await POST(postContext({ body: feedbackForm({ message: "" }) }));
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "Tell us a little about it, or add a screenshot.",
    });
  });

  it("returns 400 for a body that is not a form", async () => {
    const response = await POST(postContext({ body: "not multipart" }));
    expect(response.status).toBe(400);
  });

  it("returns 429 once the daily cap is reached", async () => {
    const insert = setup.database.prepare(
      `INSERT INTO "feedback" ("id", "userId", "kind", "message", "pageUrl")
       VALUES (?, ?, 'OTHER', 'x', 'https://x/')`
    );
    for (let index = 0; index < 30; index += 1) insert.run(`seed-${index}`, STUDENT.id);

    const response = await POST(postContext({ body: feedbackForm({ message: "more" }) }));
    expect(response.status).toBe(429);
  });
});

describe("GET /api/feedback/attachments/[id]", () => {
  function getContext(attachmentId: string, user: { id: string } | null) {
    return {
      params: { id: attachmentId },
      locals: { user },
    } as unknown as Parameters<typeof getAttachment>[0];
  }

  it("requires a signed-in user", async () => {
    const { attachmentId } = await submitAs(STUDENT.id);
    expect((await getAttachment(getContext(attachmentId, null))).status).toBe(401);
  });

  it("serves the image to its author with locked-down headers", async () => {
    const { attachmentId } = await submitAs(STUDENT.id);
    const response = await getAttachment(getContext(attachmentId, STUDENT));

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Content-Security-Policy")).toContain("sandbox");
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=3600");
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(PNG_BYTES);
  });

  it("serves it to admins, including token-authenticated agents", async () => {
    const { attachmentId } = await submitAs(STUDENT.id);
    expect((await getAttachment(getContext(attachmentId, ADMIN))).status).toBe(200);
  });

  it("hides it from other students behind the same 404 as a missing file", async () => {
    const { attachmentId } = await submitAs(STUDENT.id);
    const forbidden = await getAttachment(getContext(attachmentId, OTHER_STUDENT));
    const missing = await getAttachment(getContext("nope", OTHER_STUDENT));
    expect(forbidden.status).toBe(404);
    expect(missing.status).toBe(404);
  });

  it("returns 404 when the object is gone from storage", async () => {
    const { attachmentId } = await submitAs(STUDENT.id);
    bucket.objects.clear();
    expect((await getAttachment(getContext(attachmentId, STUDENT))).status).toBe(404);
  });
});
