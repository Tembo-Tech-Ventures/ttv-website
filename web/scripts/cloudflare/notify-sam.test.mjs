import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { notifySam, parseNotifySamArgs } from "./notify-sam.mjs";

const options = parseNotifySamArgs([
  "--kind=deploy.failed",
  "--environment=production",
  "--version=abc123",
  "--run-id=35568039482",
  "--run-attempt=2",
  "--run-url=https://github.com/tembo-tech-ventures/ttv-website/actions/runs/35568039482",
  "--health-url=https://tembotechventures.com/api/health",
  "--message=Production verification failed and rollback completed.",
]);

function runNotifyCli(args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [fileURLToPath(new URL("./notify-sam.mjs", import.meta.url)), ...args],
      {
        env: { ...process.env, ...environment },
        stdio: "pipe",
      }
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

describe("notifySam", () => {
  it("posts the mission alert payload with authenticated idempotent headers", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ status: 202 });
    const log = vi.fn();

    const result = await notifySam(options, {
      environment: {
        SAM_ALERT_WEBHOOK_URL: "https://api.simple-agent-manager.org/hooks/test",
        SAM_ALERT_WEBHOOK_TOKEN: "sam_wh_secret-token",
      },
      fetchImpl,
      now: () => new Date("2026-09-25T05:00:00.000Z"),
      log,
    });

    expect(result.status).toBe("delivered");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, request] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.simple-agent-manager.org/hooks/test");
    expect(request).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer sam_wh_secret-token",
        "Content-Type": "application/json",
        "Idempotency-Key": "deploy.failed:35568039482:2",
      },
    });
    expect(JSON.parse(request.body)).toEqual({
      source: "github-actions",
      kind: "deploy.failed",
      environment: "production",
      version: "abc123",
      count: 1,
      message: "Production verification failed and rollback completed.",
      firstSeenAt: "2026-09-25T05:00:00.000Z",
      lastSeenAt: "2026-09-25T05:00:00.000Z",
      links: {
        health: "https://tembotechventures.com/api/health",
        run: "https://github.com/tembo-tech-ventures/ttv-website/actions/runs/35568039482",
      },
    });
  });

  it.each([
    [{}, "both unset"],
    [{ SAM_ALERT_WEBHOOK_URL: "https://example.com/hook" }, "token unset"],
    [{ SAM_ALERT_WEBHOOK_TOKEN: "secret" }, "URL unset"],
  ])("skips with a notice when webhook configuration is %s", async (environment) => {
    const fetchImpl = vi.fn();
    const log = vi.fn();

    await expect(
      notifySam(options, { environment, fetchImpl, log })
    ).resolves.toEqual({ status: "skipped" });

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(expect.stringContaining("::notice::"));
  });

  it("fails on non-202 responses without exposing the webhook token", async () => {
    const token = "sam_wh_must-never-appear";
    let failure;
    try {
      await notifySam(options, {
        environment: {
          SAM_ALERT_WEBHOOK_URL: "https://api.simple-agent-manager.org/hooks/test",
          SAM_ALERT_WEBHOOK_TOKEN: token,
        },
        fetchImpl: async () => ({ status: 500 }),
        log: vi.fn(),
      });
    } catch (error) {
      failure = error;
    }

    expect(failure).toBeInstanceOf(Error);
    expect(failure.message).toContain("HTTP 500");
    expect(failure.message).not.toContain(token);
  });

  it("exits non-zero on non-202 responses without printing the token", async () => {
    const server = createServer((_request, response) => {
      response.statusCode = 503;
      response.end("not accepted");
    });
    await new Promise((resolve) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    const token = "sam_wh_cli-must-never-appear";

    try {
      const result = await runNotifyCli(
        [
          "--kind=deploy.failed",
          "--environment=production",
          "--version=abc123",
          "--run-id=35568039482",
          "--run-attempt=2",
          "--run-url=https://github.com/tembo-tech-ventures/ttv-website/actions/runs/35568039482",
          "--health-url=https://tembotechventures.com/api/health",
          "--message=Production verification failed.",
        ],
        {
          SAM_ALERT_WEBHOOK_URL: `http://127.0.0.1:${address.port}/hook`,
          SAM_ALERT_WEBHOOK_TOKEN: token,
        }
      );

      expect(result.code).not.toBe(0);
      expect(result.stderr).toContain("HTTP 503");
      expect(`${result.stdout}${result.stderr}`).not.toContain(token);
    } finally {
      await new Promise((resolve, reject) => {
        server.close((error) => {
          if (error) reject(error);
          else resolve();
        });
      });
    }
  });
});
