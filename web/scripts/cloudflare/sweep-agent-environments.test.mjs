import { describe, expect, it, vi } from "vitest";
import {
  findStaleAgentEnvironments,
  parseSweepArgs,
  sweepAgentEnvironments,
} from "./sweep-agent-environments.mjs";

const now = new Date("2026-07-14T12:00:00.000Z");
const workers = [
  {
    id: "ttv-website-agent-old-task",
    modified_on: "2026-07-10T12:00:00.000Z",
  },
  {
    id: "ttv-website-agent-active-task",
    modified_on: "2026-07-14T10:00:00.000Z",
  },
  {
    id: "ttv-website-staging",
    modified_on: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "unrelated-agent-old-task",
    modified_on: "2026-01-01T00:00:00.000Z",
  },
];
const containers = [
  {
    id: "container-old",
    name: "ttv-website-agent-orphaned-ffmpegcontainer",
    created_at: "2026-07-09T12:00:00.000Z",
    updated_at: "2026-07-10T13:00:00.000Z",
  },
  {
    id: "container-production",
    name: "ttv-website-production-ffmpegcontainer",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
  {
    id: "container-unrelated",
    name: "unrelated-agent-old-ffmpegcontainer",
    updated_at: "2026-01-01T00:00:00.000Z",
  },
];

describe("stale agent environment selection", () => {
  it("selects only old agent-prefixed workers for this application", () => {
    expect(
      findStaleAgentEnvironments({ workers, now, maxAgeHours: 72 })
    ).toEqual([
      {
        environmentName: "agent-old-task",
        workerName: "ttv-website-agent-old-task",
        lastModified: "2026-07-10T12:00:00.000Z",
        ageHours: 96,
      },
    ]);
  });

  it("honors explicit active-environment exclusions", () => {
    expect(
      findStaleAgentEnvironments({
        workers,
        now,
        maxAgeHours: 6,
        excludedEnvironments: ["agent-old-task"],
      })
    ).toEqual([]);
  });

  it("discovers partial environments from D1 and uses the freshest resource timestamp", () => {
    expect(
      findStaleAgentEnvironments({
        workers: [],
        databases: [
          {
            name: "ttv-website-db-agent-orphaned",
            created_at: "2026-07-10T12:00:00.000Z",
          },
        ],
        now,
        maxAgeHours: 72,
      })
    ).toEqual([
      {
        environmentName: "agent-orphaned",
        databaseName: "ttv-website-db-agent-orphaned",
        lastModified: "2026-07-10T12:00:00.000Z",
        ageHours: 96,
      },
    ]);

    expect(
      findStaleAgentEnvironments({
        workers: [workers[0]],
        databases: [
          {
            name: "ttv-website-db-agent-old-task",
            created_at: "2026-07-14T10:00:00.000Z",
          },
        ],
        now,
        maxAgeHours: 72,
      })
    ).toEqual([]);
  });

  it("discovers orphaned container apps with exact application-name guards", () => {
    expect(
      findStaleAgentEnvironments({
        workers: [],
        databases: [],
        containers: [
          ...containers,
          {
            name: "ttv-website-agent-wrong-container",
            updated_at: "2026-01-01T00:00:00.000Z",
          },
          {
            name: "ttv-website-agent-orphaned-ffmpegcontainer-extra",
            updated_at: "2026-01-01T00:00:00.000Z",
          },
        ],
        now,
        maxAgeHours: 72,
      })
    ).toEqual([
      {
        environmentName: "agent-orphaned",
        containerAppName: "ttv-website-agent-orphaned-ffmpegcontainer",
        lastModified: "2026-07-10T13:00:00.000Z",
        ageHours: 95,
      },
    ]);
  });

  it("merges container apps with other resources and protects explicit exclusions", () => {
    const merged = findStaleAgentEnvironments({
      workers: [workers[0]],
      containers: [
        {
          name: "ttv-website-agent-old-task-ffmpegcontainer",
          updated_at: "2026-07-10T13:00:00.000Z",
        },
      ],
      now,
      maxAgeHours: 72,
    });
    expect(merged).toEqual([
      {
        environmentName: "agent-old-task",
        workerName: "ttv-website-agent-old-task",
        containerAppName: "ttv-website-agent-old-task-ffmpegcontainer",
        lastModified: "2026-07-10T13:00:00.000Z",
        ageHours: 95,
      },
    ]);

    expect(
      findStaleAgentEnvironments({
        containers,
        now,
        maxAgeHours: 72,
        excludedEnvironments: ["agent-orphaned"],
      })
    ).toEqual([]);
  });

  it("defaults to dry-run and rejects unsafe age windows", () => {
    expect(parseSweepArgs([])).toEqual({
      execute: false,
      maxAgeHours: 72,
      excludedEnvironments: [],
    });
    expect(() => parseSweepArgs(["--max-age-hours=1"])).toThrow("at least 6");
    expect(parseSweepArgs(["--exclude=agent-one,"])).toMatchObject({
      excludedEnvironments: ["agent-one"],
    });
  });
});

describe("stale agent environment cleanup", () => {
  it("does not mutate anything in dry-run mode", async () => {
    const destroy = vi.fn();
    const result = await sweepAgentEnvironments({
      workers,
      now,
      maxAgeHours: 72,
      destroy,
    });
    expect(result.mode).toBe("dry-run");
    expect(result.candidates).toHaveLength(1);
    expect(destroy).not.toHaveBeenCalled();
  });

  it("reports an orphaned container app in dry-run mode without deleting it", async () => {
    const destroy = vi.fn();
    const result = await sweepAgentEnvironments({
      containers,
      now,
      maxAgeHours: 72,
      destroy,
    });
    expect(result.mode).toBe("dry-run");
    expect(result.candidates).toEqual([
      expect.objectContaining({
        environmentName: "agent-orphaned",
        containerAppName: "ttv-website-agent-orphaned-ffmpegcontainer",
      }),
    ]);
    expect(destroy).not.toHaveBeenCalled();
  });

  it("deletes every selected environment and reports blocked cleanup", async () => {
    const destroy = vi.fn().mockRejectedValue(new Error("R2 bucket is not empty"));
    const result = await sweepAgentEnvironments({
      execute: true,
      workers,
      now,
      maxAgeHours: 72,
      destroy,
    });
    expect(destroy).toHaveBeenCalledWith("agent-old-task");
    expect(result.results).toEqual([
      expect.objectContaining({
        environmentName: "agent-old-task",
        status: "blocked",
        error: "R2 bucket is not empty",
      }),
    ]);
  });
});
