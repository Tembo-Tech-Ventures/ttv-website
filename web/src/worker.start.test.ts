import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * What an isolate loads at start: the recording pipeline, Drive import and
 * alert push run only on queue and cron events, so worker.ts imports them on
 * first use. Each test gets a fresh module graph and registers each factory
 * once, so what loads is observed from the start whatever the order.
 */
const mocks = vi.hoisted(() => ({
  loaded: new Set<string>(),
  processRecordingMessage: vi.fn(),
  syncEnabledRecordingImportSources: vi.fn().mockResolvedValue([]),
  pushAlerts: vi.fn().mockResolvedValue({ created: 0, attempted: 0, sent: 0 }),
  recordError: vi.fn().mockResolvedValue(null),
}));
vi.mock("@cloudflare/containers", () => ({ Container: class {}, ContainerProxy: class {} }));
vi.mock("@astrojs/cloudflare/handler", () => ({ handle: vi.fn() }));
vi.mock("@/lib/observability/errors", () => ({ recordError: mocks.recordError }));

const track = <T,>(name: string, module: T) => () => {
  mocks.loaded.add(name);
  return module;
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mocks.loaded.clear();
  vi.doMock("@/lib/recordings/importer", track("importer", { syncEnabledRecordingImportSources: mocks.syncEnabledRecordingImportSources }));
  vi.doMock("@/lib/observability/alerts", track("alerts", { pushAlerts: mocks.pushAlerts }));
});

const batch = (type: string, ack = vi.fn()) => ({ messages: [{ body: { type }, ack }] }) as unknown as MessageBatch<unknown>;

describe("Worker start", () => {
  it("loads the recording pipeline, Drive import and alert push only for the events that need them", async () => {
    vi.doMock("@/lib/recordings/pipeline", track("pipeline", { processRecordingMessage: mocks.processRecordingMessage }));
    const { default: worker } = await import("./worker");
    expect([...mocks.loaded]).toEqual([]);
    const waitUntil = vi.fn();
    worker.scheduled?.({ cron: "*/15 * * * *" } as ScheduledController, {} as Env, { waitUntil } as unknown as ExecutionContext);
    await waitUntil.mock.calls[0][0];
    expect([...mocks.loaded].toSorted()).toEqual(["alerts", "importer"]);
    await worker.queue?.(batch("process_recording"), {} as Env);
    expect([...mocks.loaded].toSorted()).toEqual(["alerts", "importer", "pipeline"]);
  });

  it("records a recording pipeline that fails to load, and leaves the message to retry", async () => {
    vi.doMock("@/lib/recordings/pipeline", () => {
      throw new Error("pipeline failed to load");
    });
    const { default: worker } = await import("./worker");
    const ack = vi.fn();
    const env = { DB: {}, DEPLOYMENT_VERSION: "v3" } as unknown as Env;
    const failure = await worker.queue?.(batch("reindex_recording", ack), env).then(() => undefined, (error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    expect(ack).not.toHaveBeenCalled();
    expect(mocks.recordError).toHaveBeenCalledWith(env.DB, { source: "queue", route: "/queue/reindex_recording", error: failure, version: "v3" });
  });
});
