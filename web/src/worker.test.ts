import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  syncEnabledRecordingImportSources: vi.fn().mockResolvedValue([]),
  handle: vi.fn(),
  processRecordingMessage: vi.fn(),
}));

vi.mock("@cloudflare/containers", () => ({
  Container: class {},
}));
vi.mock("@astrojs/cloudflare/handler", () => ({
  handle: mocks.handle,
}));
vi.mock("@/lib/recordings/pipeline", () => ({
  processRecordingMessage: mocks.processRecordingMessage,
}));
vi.mock("@/lib/recordings/importer", () => ({
  syncEnabledRecordingImportSources:
    mocks.syncEnabledRecordingImportSources,
}));

import worker from "./worker";

describe("Worker scheduled imports", () => {
  it("registers enabled Drive source syncing with the execution context", async () => {
    const waitUntil = vi.fn();
    const env = {} as Env;

    worker.scheduled?.(
      { cron: "*/15 * * * *" } as ScheduledController,
      env,
      { waitUntil } as unknown as ExecutionContext
    );

    expect(mocks.syncEnabledRecordingImportSources).toHaveBeenCalledWith(env);
    expect(waitUntil).toHaveBeenCalledOnce();
    await expect(waitUntil.mock.calls[0][0]).resolves.toEqual([]);
  });
});
