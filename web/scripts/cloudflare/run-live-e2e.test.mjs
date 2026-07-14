import { describe, expect, it } from "vitest";
import { deriveAgentPreviewToken } from "./agent-preview-auth.mjs";
import { resolvePlaywrightAgentToken } from "./run-live-e2e.mjs";

describe("live browser authentication", () => {
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
        EXPECTED_DEPLOYMENT_ENVIRONMENT: "agent-pr-55",
      })
    ).toBe(deriveAgentPreviewToken(previewSecret, "agent-pr-55"));
  });

  it("never treats the preview secret as a shared staging token", () => {
    expect(
      resolvePlaywrightAgentToken({
        AGENT_PREVIEW_SECRET: "p".repeat(32),
        EXPECTED_DEPLOYMENT_ENVIRONMENT: "staging",
      })
    ).toBeUndefined();
  });
});
