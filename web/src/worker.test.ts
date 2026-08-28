import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  syncEnabledRecordingImportSources: vi.fn().mockResolvedValue([]),
  handle: vi.fn(),
  processRecordingMessage: vi.fn(),
}));

vi.mock("@cloudflare/containers", () => ({
  Container: class {},
  ContainerProxy: class {},
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

import worker, { ContainerProxy, FfmpegContainer } from "./worker";

describe("Worker container exports", () => {
  it("exports the proxy entrypoint required by outbound R2 interception", () => {
    expect(ContainerProxy).toBeTypeOf("function");
  });

  it("explicitly destroys the FFmpeg container when activity expires", async () => {
    const container = new FfmpegContainer({} as never, {} as never);
    const destroy = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(container, "destroy", { value: destroy });

    await container.onActivityExpired();

    expect(destroy).toHaveBeenCalledOnce();
  });

  it("checks health from inside the container object and destroys afterward", async () => {
    const container = new FfmpegContainer({} as never, {} as never);
    const start = vi.fn().mockResolvedValue(undefined);
    const destroy = vi.fn().mockResolvedValue(undefined);
    const containerFetch = vi.fn().mockResolvedValue(Response.json({ ok: true }));
    Object.defineProperties(container, {
      start: { value: start },
      destroy: { value: destroy },
      containerFetch: { value: containerFetch },
    });

    await expect(container.checkHealth()).resolves.toEqual({
      ok: true,
      status: 200,
      text: JSON.stringify({ ok: true }),
    });
    expect(start).toHaveBeenCalledBefore(containerFetch);
    expect(containerFetch).toHaveBeenCalledWith(
      "https://ffmpeg/health",
      undefined
    );
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("destroys the container when an RPC fetch fails", async () => {
    const container = new FfmpegContainer({} as never, {} as never);
    const start = vi.fn().mockResolvedValue(undefined);
    const destroy = vi.fn().mockResolvedValue(undefined);
    const containerFetch = vi.fn().mockRejectedValue(new Error("failed"));
    Object.defineProperties(container, {
      start: { value: start },
      destroy: { value: destroy },
      containerFetch: { value: containerFetch },
    });

    await expect(
      container.processRecording({
        recordingId: "recording1",
        r2VideoKey: "recordings/recording1/source.mp4",
      })
    ).rejects.toThrow("failed");
    expect(destroy).toHaveBeenCalledOnce();
  });

  it("routes process and segment RPC calls through containerFetch", async () => {
    const container = new FfmpegContainer({} as never, {} as never);
    const start = vi.fn().mockResolvedValue(undefined);
    const destroy = vi.fn().mockResolvedValue(undefined);
    const containerFetch = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ ok: true }))
      .mockResolvedValueOnce(Response.json({ ok: true }));
    Object.defineProperties(container, {
      start: { value: start },
      destroy: { value: destroy },
      containerFetch: { value: containerFetch },
    });

    await container.processRecording({
      recordingId: "recording1",
      r2VideoKey: "recordings/recording1/source.mp4",
    });
    await container.segmentAudio({
      recordingId: "recording1",
      r2AudioKey: "recordings/recording1/audio.mp3",
    });

    expect(containerFetch).toHaveBeenCalledWith(
      "https://ffmpeg/process",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          recordingId: "recording1",
          r2VideoKey: "recordings/recording1/source.mp4",
        }),
      })
    );
    expect(containerFetch).toHaveBeenCalledWith(
      "https://ffmpeg/segment",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          recordingId: "recording1",
          r2AudioKey: "recordings/recording1/audio.mp3",
        }),
      })
    );
    expect(destroy).toHaveBeenCalledTimes(2);
  });
});

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
