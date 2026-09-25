import { describe, expect, it, vi } from "vitest";
import {
  captureRollbackTarget,
  parseRollbackArgs,
  rollbackProduction,
} from "./rollback.mjs";

const VERSION_ID = "095f00a7-23a7-43b7-a227-e4c97cab5f22";

describe("parseRollbackArgs", () => {
  it("parses capture and rollback commands", () => {
    expect(
      parseRollbackArgs([
        "capture",
        "--environment=production",
        "--worker-name=ttv-website-production",
        "--health-url=https://tembotechventures.com/api/health",
      ])
    ).toMatchObject({
      command: "capture",
      environmentName: "production",
      workerName: "ttv-website-production",
      healthUrl: "https://tembotechventures.com/api/health",
      dryRun: false,
    });

    expect(
      parseRollbackArgs([
        "rollback",
        "--environment=production",
        "--worker-name=ttv-website-production",
        `--version-id=${VERSION_ID}`,
        "--dry-run",
      ])
    ).toMatchObject({
      command: "rollback",
      versionId: VERSION_ID,
      dryRun: true,
    });
  });

  it.each(["agent-pr-123", "staging", "prod", "development"])(
    "refuses rollback operations for %s",
    (environmentName) => {
      expect(() =>
        parseRollbackArgs([
          "rollback",
          `--environment=${environmentName}`,
          "--worker-name=ttv-website-test",
          `--version-id=${VERSION_ID}`,
        ])
      ).toThrow(/forbidden|restricted/);
    }
  );
});

describe("captureRollbackTarget", () => {
  it("captures the active Worker version and currently served health version", async () => {
    const runWranglerImpl = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        versions: [{ version_id: VERSION_ID, percentage: 100 }],
      }),
      stderr: "",
    });
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ environment: "production", version: "previous-sha" }),
    });
    const writeOutput = vi.fn();

    await expect(
      captureRollbackTarget(
        {
          environmentName: "production",
          workerName: "ttv-website-production",
          healthUrl: "https://tembotechventures.com/api/health",
        },
        { runWranglerImpl, fetchImpl, writeOutput }
      )
    ).resolves.toMatchObject({
      workerVersionId: VERSION_ID,
      healthVersion: "previous-sha",
    });

    expect(runWranglerImpl).toHaveBeenCalledWith([
      "deployments",
      "status",
      "--name",
      "ttv-website-production",
      "--json",
    ]);
    expect(writeOutput).toHaveBeenCalledWith("worker_version_id", VERSION_ID);
    expect(writeOutput).toHaveBeenCalledWith("health_version", "previous-sha");
  });

  it("refuses ambiguous split deployments", async () => {
    const runWranglerImpl = vi.fn().mockResolvedValue({
      stdout: JSON.stringify({
        versions: [
          { version_id: VERSION_ID, percentage: 50 },
          {
            version_id: "1a88955c-2fbd-4a72-9d9b-3ba1e59842f2",
            percentage: 50,
          },
        ],
      }),
    });

    await expect(
      captureRollbackTarget(
        {
          environmentName: "production",
          workerName: "ttv-website-production",
          healthUrl: "https://tembotechventures.com/api/health",
        },
        {
          runWranglerImpl,
          fetchImpl: async () => ({
            ok: true,
            json: async () => ({
              environment: "production",
              version: "previous-sha",
            }),
          }),
          writeOutput: vi.fn(),
        }
      )
    ).rejects.toThrow("one Worker version serving 100%");
  });
});

describe("rollbackProduction", () => {
  it("invokes Wrangler with an exact version and a non-interactive message", async () => {
    const runWranglerImpl = vi.fn().mockResolvedValue({});

    await rollbackProduction(
      {
        environmentName: "production",
        workerName: "ttv-website-production",
        versionId: VERSION_ID,
        dryRun: false,
      },
      { runWranglerImpl }
    );

    expect(runWranglerImpl).toHaveBeenCalledWith([
      "rollback",
      VERSION_ID,
      "--name",
      "ttv-website-production",
      "--message",
      "Automated rollback after failed production verification",
    ]);
  });

  it("reports a dry run without invoking Wrangler", async () => {
    const runWranglerImpl = vi.fn();
    const log = vi.fn();

    await expect(
      rollbackProduction(
        {
          environmentName: "production",
          workerName: "ttv-website-production",
          versionId: VERSION_ID,
          dryRun: true,
        },
        { runWranglerImpl, log }
      )
    ).resolves.toMatchObject({ dryRun: true });

    expect(runWranglerImpl).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("Dry run"));
  });
});
