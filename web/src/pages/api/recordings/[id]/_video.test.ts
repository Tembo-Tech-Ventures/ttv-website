import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PlatformCapabilities } from "@/lib/platform/server/capabilities";

const mocks = vi.hoisted(() => ({
  env: {
    DB: {} as Record<string, unknown>,
    BUCKET: {
      head: vi.fn(),
      get: vi.fn(),
    },
  },
  drizzle: vi.fn(),
  requestCapabilities: vi.fn(),
}));

vi.mock("cloudflare:workers", () => ({ env: mocks.env }));
vi.mock("drizzle-orm/d1", () => ({ drizzle: mocks.drizzle }));
vi.mock("@/lib/platform/server/request-capabilities", () => ({
  requestCapabilities: mocks.requestCapabilities,
}));

import { GET } from "./video";

const student: PlatformCapabilities = {
  spaces: ["cohort", "community", "profile"], cohortIds: ["program-audit"], mentorCohortIds: [], teachingCohortIds: [],
  isMentor: false, isInstitution: false, isAdmin: false,
};
const admin: PlatformCapabilities = { ...student, spaces: ["cohort", "community", "discover", "admin", "profile"], cohortIds: [], isAdmin: true };

function useRecording(recording: Record<string, unknown> | undefined) {
  mocks.drizzle.mockReturnValue({
    query: { recording: { findFirst: vi.fn().mockResolvedValue(recording) } },
  });
}

/** The route's context. locals.isAdmin is false, as middleware leaves it outside /admin. */
function context({ user = { id: "user-1" }, range }: { user?: Record<string, unknown> | null; range?: string } = {}) {
  return {
    params: { id: "recording-1" },
    request: new Request("https://example.com/api/recordings/recording-1/video", { headers: range ? { range } : {} }),
    locals: { user, isAdmin: false },
  } as unknown as Parameters<typeof GET>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  useRecording({
    programId: "program-audit", accessScope: "COHORT", deletedAt: null, hiddenAt: null,
    r2VideoKey: "recordings/video.mp4",
  });
  mocks.requestCapabilities.mockResolvedValue(student);
  mocks.env.BUCKET.head.mockResolvedValue({ size: 5 });
  mocks.env.BUCKET.get.mockResolvedValue({
    body: "video",
    httpMetadata: { contentType: "video/mp4" },
  });
});

describe("GET /api/recordings/[id]/video", () => {
  it("returns 401 before looking up a recording when the user is signed out", async () => {
    const response = await GET(context({ user: null }));

    expect(response.status).toBe(401);
    expect(mocks.drizzle).not.toHaveBeenCalled();
    expect(mocks.requestCapabilities).not.toHaveBeenCalled();
  });

  it("answers a recording the policy refuses exactly as a missing one, before touching the bucket", async () => {
    mocks.requestCapabilities.mockResolvedValue({ ...student, cohortIds: ["another-program"] });
    const refused = await GET(context());
    useRecording(undefined);
    const missing = await GET(context());

    expect([refused.status, missing.status]).toEqual([404, 404]);
    expect(await refused.json()).toEqual(await missing.json());
    expect(mocks.env.BUCKET.head).not.toHaveBeenCalled();
  });

  it("streams a recording in the caller's cohort, at any processing status", async () => {
    const response = await GET(context());

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("video/mp4");
    await expect(response.text()).resolves.toBe("video");
  });

  it("streams any cohort's recording to an admin, though middleware sets locals.isAdmin only under /admin", async () => {
    mocks.requestCapabilities.mockResolvedValue(admin);

    expect((await GET(context())).status).toBe(200);
  });

  it("plays a recording with no cohort to admins only", async () => {
    useRecording({ programId: null, accessScope: "ADMIN_ONLY", deletedAt: null, hiddenAt: null, r2VideoKey: "recordings/loose.mp4" });
    expect((await GET(context())).status).toBe(404);

    mocks.requestCapabilities.mockResolvedValue(admin);
    expect((await GET(context())).status).toBe(200);
  });

  it("plays a deleted recording to nobody, admins included", async () => {
    useRecording({ programId: "program-audit", accessScope: "COHORT", deletedAt: new Date(0), hiddenAt: null, r2VideoKey: "recordings/video.mp4" });
    mocks.requestCapabilities.mockResolvedValue(admin);

    expect((await GET(context())).status).toBe(404);
  });

  it("is a 404 while no video is stored", async () => {
    useRecording({ programId: "program-audit", accessScope: "COHORT", deletedAt: null, hiddenAt: null, r2VideoKey: null });

    expect((await GET(context())).status).toBe(404);
    expect(mocks.env.BUCKET.head).not.toHaveBeenCalled();
  });

  it("serves a byte range", async () => {
    const response = await GET(context({ range: "bytes=1-3" }));

    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe("bytes 1-3/5");
    expect(mocks.env.BUCKET.get).toHaveBeenCalledWith("recordings/video.mp4", { range: { offset: 1, length: 3 } });
  });
});
