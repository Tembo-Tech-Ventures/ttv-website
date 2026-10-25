import { describe, expect, it, vi } from "vitest";
import {
  parseActivePrPreviewEnvironments,
  reclaimClosedPrPreviewGateways,
  runDeploymentWithAgentCleanup,
} from "./deploy.mjs";

const agentContext = {
  appName: "ttv-website",
  environmentName: "agent-pr-72",
  environmentSlug: "agent-pr-72",
};

describe("PR preview gateway reclamation", () => {
  it("normalizes and deduplicates the open-PR inventory", () => {
    expect(
      parseActivePrPreviewEnvironments(
        "agent-pr-71, agent-pr-72,agent-pr-71"
      )
    ).toEqual(["agent-pr-71", "agent-pr-72"]);
  });

  it("protects every open PR and passes only validated context to reclamation", async () => {
    const reclaim = vi.fn().mockResolvedValue([
      "ttv-website-ai-agent-pr-70",
    ]);

    await expect(
      reclaimClosedPrPreviewGateways(agentContext, {
        activeEnvironmentValue: "agent-pr-71,agent-pr-72",
        reclaim,
      })
    ).resolves.toEqual(["ttv-website-ai-agent-pr-70"]);
    expect(reclaim).toHaveBeenCalledWith({
      appName: "ttv-website",
      activeEnvironmentNames: ["agent-pr-71", "agent-pr-72"],
    });
  });

  it("fails closed when the current PR is absent from the active inventory", async () => {
    const reclaim = vi.fn();
    await expect(
      reclaimClosedPrPreviewGateways(agentContext, {
        activeEnvironmentValue: "agent-pr-71",
        reclaim,
      })
    ).rejects.toThrow(
      'does not include the current environment "agent-pr-72"'
    );
    expect(reclaim).not.toHaveBeenCalled();
  });

  it("does not reclaim gateways for direct-agent, staging, or production deploys", async () => {
    const reclaim = vi.fn();
    for (const environmentSlug of ["agent-task-1", "staging", "production"]) {
      await expect(
        reclaimClosedPrPreviewGateways(
          {
            ...agentContext,
            environmentName: environmentSlug,
            environmentSlug,
          },
          { activeEnvironmentValue: undefined, reclaim }
        )
      ).resolves.toEqual([]);
    }
    expect(reclaim).not.toHaveBeenCalled();
  });
});

describe("failed agent deployment cleanup", () => {
  it("cleans only the exact agent environment and preserves the original failure", async () => {
    const deploymentError = new Error(
      "You have reached the max number of gateways you can create"
    );
    const cleanup = vi.fn().mockResolvedValue({});

    await expect(
      runDeploymentWithAgentCleanup(
        agentContext,
        vi.fn().mockRejectedValue(deploymentError),
        cleanup
      )
    ).rejects.toBe(deploymentError);
    expect(cleanup).toHaveBeenCalledOnce();
    expect(cleanup).toHaveBeenCalledWith(agentContext);
  });

  it("never runs failure cleanup for staging or production", async () => {
    const cleanup = vi.fn();
    for (const environmentName of ["staging", "production"]) {
      const deploymentError = new Error(`${environmentName} failed`);
      await expect(
        runDeploymentWithAgentCleanup(
          {
            ...agentContext,
            environmentName,
            environmentSlug: environmentName,
          },
          vi.fn().mockRejectedValue(deploymentError),
          cleanup
        )
      ).rejects.toBe(deploymentError);
    }
    expect(cleanup).not.toHaveBeenCalled();
  });

  it("reports both deployment and cleanup failures without hiding either", async () => {
    const deploymentError = new Error("gateway quota reached");
    const cleanupError = new Error("R2 listing could not be verified");

    await expect(
      runDeploymentWithAgentCleanup(
        agentContext,
        vi.fn().mockRejectedValue(deploymentError),
        vi.fn().mockRejectedValue(cleanupError)
      )
    ).rejects.toMatchObject({
      message:
        "Agent deployment failed: gateway quota reached. Cleanup also failed: R2 listing could not be verified",
      errors: [deploymentError, cleanupError],
    });
  });

  it("does not clean up a successful deployment", async () => {
    const cleanup = vi.fn();
    await expect(
      runDeploymentWithAgentCleanup(
        agentContext,
        vi.fn().mockResolvedValue("deployed"),
        cleanup
      )
    ).resolves.toBe("deployed");
    expect(cleanup).not.toHaveBeenCalled();
  });
});
