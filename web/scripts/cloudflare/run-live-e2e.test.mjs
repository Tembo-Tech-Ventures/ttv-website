import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import {
  deriveAgentPreviewPersonaToken,
  deriveAgentPreviewToken,
} from "./agent-preview-auth.mjs";
import {
  main,
  resolvePlaywrightAgentToken,
  resolvePlaywrightPersonaTokens,
} from "./run-live-e2e.mjs";

describe("live browser authentication", () => {
  it("rejects missing run scope instead of deriving legacy preview credentials", () => {
    const environment = { AGENT_PREVIEW_SECRET: "p".repeat(32), EXPECTED_DEPLOYMENT_ENVIRONMENT: "agent-pr-55" };
    expect(() => resolvePlaywrightAgentToken(environment)).toThrow("AGENT_PREVIEW_RUN_ID");
    expect(() => resolvePlaywrightPersonaTokens(environment)).toThrow("AGENT_PREVIEW_RUN_ID");
  });
  it("uses a securely supplied personal access token for live verification", () => {
    expect(
      resolvePlaywrightAgentToken({
        TTV_PERSONAL_ACCESS_TOKEN: `ttv_pat_${"a".repeat(64)}`,
        EXPECTED_DEPLOYMENT_ENVIRONMENT: "production",
      })
    ).toBe(`ttv_pat_${"a".repeat(64)}`);
  });

  it("prefers an explicit PAT over environment-specific delegated auth", () => {
    expect(
      resolvePlaywrightAgentToken({
        TTV_PERSONAL_ACCESS_TOKEN: `ttv_pat_${"b".repeat(64)}`,
        PLAYWRIGHT_AGENT_TOKEN: "staging-session-token",
      })
    ).toBe(`ttv_pat_${"b".repeat(64)}`);
  });

  it("uses an explicitly supplied shared-environment token", () => {
    expect(
      resolvePlaywrightAgentToken({
        PLAYWRIGHT_AGENT_TOKEN: "staging-session-token",
        EXPECTED_DEPLOYMENT_ENVIRONMENT: "staging",
      })
    ).toBe("staging-session-token");
  });

  it("derives the isolated token without printing or persisting it", () => {
    const previewSecret = "p".repeat(32);
    expect(
      resolvePlaywrightAgentToken({
        AGENT_PREVIEW_SECRET: previewSecret,
        AGENT_PREVIEW_RUN_ID: "github-123-1",
        EXPECTED_DEPLOYMENT_ENVIRONMENT: "agent-pr-55",
      })
    ).toBe(deriveAgentPreviewToken(previewSecret, "agent-pr-55", "github-123-1"));
  });

  it("never treats the preview secret as a shared staging token", () => {
    expect(
      resolvePlaywrightAgentToken({
        AGENT_PREVIEW_SECRET: "p".repeat(32),
        AGENT_PREVIEW_RUN_ID: "github-123-1",
        EXPECTED_DEPLOYMENT_ENVIRONMENT: "staging",
      })
    ).toBeUndefined();
  });

  it("supplies deterministic tokens for the isolated student journeys", () => {
    const previewSecret = "p".repeat(32);
    expect(
      resolvePlaywrightPersonaTokens({
        AGENT_PREVIEW_SECRET: previewSecret,
        AGENT_PREVIEW_RUN_ID: "github-123-1",
        EXPECTED_DEPLOYMENT_ENVIRONMENT: "agent-pr-55",
      })
    ).toEqual({
      PLAYWRIGHT_NEW_STUDENT_TOKEN: deriveAgentPreviewPersonaToken(
        previewSecret,
        "agent-pr-55",
        "newStudent", "github-123-1"
      ),
      PLAYWRIGHT_ACCEPTED_STUDENT_TOKEN: deriveAgentPreviewPersonaToken(
        previewSecret,
        "agent-pr-55",
        "acceptedStudent", "github-123-1"
      ),
      PLAYWRIGHT_GRADUATE_STUDENT_TOKEN: deriveAgentPreviewPersonaToken(
        previewSecret,
        "agent-pr-55",
        "graduateStudent", "github-123-1"
      ),
    });
  });

  it("never derives persona tokens outside isolated previews", () => {
    expect(
      resolvePlaywrightPersonaTokens({
        AGENT_PREVIEW_SECRET: "p".repeat(32),
        AGENT_PREVIEW_RUN_ID: "github-123-1",
        EXPECTED_DEPLOYMENT_ENVIRONMENT: "production",
      })
    ).toEqual({});
  });
});


describe("feedback identity runner integration", () => {
  function child(code = 0) {
    return vi.fn(() => { const emitter = new EventEmitter(); globalThis.queueMicrotask(() => emitter.emit("close", code)); return emitter; });
  }
  it("passes the runtime-only feedback token to the child and awaits cleanup", async () => {
    const spawnImpl = child(); let cleaned = false;
    const withFeedbackWriter = vi.fn(async ({ run }) => { try { await run("fictional-runtime-token"); } finally { cleaned = true; } });
    await main([], { environment: { EXPECTED_DEPLOYMENT_ENVIRONMENT: "agent-pr-171-1" }, spawnImpl, withFeedbackWriter });
    expect(cleaned).toBe(true);
    expect(spawnImpl.mock.calls[0][2].env.PLAYWRIGHT_FEEDBACK_STUDENT_TOKEN).toBe("fictional-runtime-token");
    expect(spawnImpl.mock.calls[0][1].join(" ")).not.toContain("fictional-runtime-token");
  });
  it("propagates child failure through the lifecycle", async () => {
    let cleaned = false;
    await expect(main([], { environment: { EXPECTED_DEPLOYMENT_ENVIRONMENT: "agent-pr-171-1" }, spawnImpl: child(1), withFeedbackWriter: async ({ run }) => { try { await run("fictional"); } finally { cleaned = true; } } })).rejects.toThrow("Playwright exited");
    expect(cleaned).toBe(true);
  });
  it.each(["staging", "production"])("does not provision or forward feedback credentials in %s", async environmentName => {
    const spawnImpl = child(), withFeedbackWriter = vi.fn();
    await main([], { environment: { EXPECTED_DEPLOYMENT_ENVIRONMENT: environmentName, PLAYWRIGHT_FEEDBACK_STUDENT_TOKEN: "do-not-forward" }, spawnImpl, withFeedbackWriter });
    expect(withFeedbackWriter).not.toHaveBeenCalled();
    expect(spawnImpl.mock.calls[0][2].env.PLAYWRIGHT_FEEDBACK_STUDENT_TOKEN).toBe("");
  });
  it("list mode never provisions", async () => {
    const withFeedbackWriter = vi.fn();
    await main(["--list"], { environment: { EXPECTED_DEPLOYMENT_ENVIRONMENT: "agent-pr-171-1" }, spawnImpl: child(), withFeedbackWriter });
    expect(withFeedbackWriter).not.toHaveBeenCalled();
  });
});
