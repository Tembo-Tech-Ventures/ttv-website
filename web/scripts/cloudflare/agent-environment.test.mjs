import { describe, expect, it } from "vitest";
import { prepareAgentEnvironment } from "./agent-environment.mjs";

describe("prepareAgentEnvironment", () => {
  it("derives an isolated environment and clears custom domains", () => {
    const environment = {
      SAM_TASK_ID: "01KXH3N3SGB464KS2P2H14537E",
      CLOUDFLARE_PRIMARY_DOMAIN: "tembotechventures.com",
      CLOUDFLARE_REDIRECT_DOMAIN: "www.tembotechventures.com",
      CLOUDFLARE_BETTER_AUTH_URL: "https://tembotechventures.com",
    };

    expect(prepareAgentEnvironment(environment)).toBe("agent-ks2p2h14537e");
    expect(environment).toMatchObject({
      CLOUDFLARE_ENVIRONMENT_NAME: "agent-ks2p2h14537e",
      CLOUDFLARE_PRIMARY_DOMAIN: "",
      CLOUDFLARE_REDIRECT_DOMAIN: "",
      CLOUDFLARE_BETTER_AUTH_URL: "",
    });
  });

  it("refuses to repurpose a non-agent environment", () => {
    expect(() =>
      prepareAgentEnvironment({ CLOUDFLARE_ENVIRONMENT_NAME: "production" })
    ).toThrow('must use an "agent-" prefix');
  });
});
