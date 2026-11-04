import { describe, expect, it } from "vitest";
import { samLoginAuthorized, samLoginConfig } from "./config";
import { ORIGIN, PROJECT_ID, SAM_USER_ID } from "./test-tokens";

const staging = {
  DEPLOYMENT_ENVIRONMENT: "staging",
  BETTER_AUTH_URL: ORIGIN,
  SAM_LOGIN_PROJECT_ID: PROJECT_ID,
  SAM_LOGIN_USER_IDS: ` ${SAM_USER_ID} , second-user `,
};

describe("samLoginConfig", () => {
  it("is on for staging with a project and its allowed users", () => {
    expect(samLoginConfig(staging)).toEqual({ origin: ORIGIN, projectId: PROJECT_ID, userIds: new Set([SAM_USER_ID, "second-user"]) });
  });

  it.each([
    ["production", { DEPLOYMENT_ENVIRONMENT: "production" }],
    ["an agent preview", { DEPLOYMENT_ENVIRONMENT: "agent-pr-12" }],
    ["no environment", { DEPLOYMENT_ENVIRONMENT: undefined }],
    ["no project", { SAM_LOGIN_PROJECT_ID: undefined }],
    ["no users", { SAM_LOGIN_USER_IDS: " , " }],
    ["a malformed user", { SAM_LOGIN_USER_IDS: `${SAM_USER_ID},bad user` }],
    ["a malformed project", { SAM_LOGIN_PROJECT_ID: "../x" }],
    ["no site URL", { BETTER_AUTH_URL: undefined }],
    ["a plain-http deployed site", { BETTER_AUTH_URL: "http://staging.tembotechventures.com" }],
  ])("is off for %s", (_, overrides) => {
    expect(samLoginConfig({ ...staging, ...overrides })).toBeNull();
  });

  it("allows plain http only for a local staging-mode build", () => {
    expect(samLoginConfig({ ...staging, BETTER_AUTH_URL: "http://127.0.0.1:4321" })?.origin).toBe("http://127.0.0.1:4321");
  });
});

describe("samLoginAuthorized", () => {
  const config = samLoginConfig(staging)!;
  it("authorizes only an allowed user of the configured project", () => {
    expect(samLoginAuthorized(config, { projectId: PROJECT_ID, userId: SAM_USER_ID })).toBe(true);
    expect(samLoginAuthorized(config, { projectId: PROJECT_ID, userId: "someone-else" })).toBe(false);
    expect(samLoginAuthorized(config, { projectId: "another-project", userId: SAM_USER_ID })).toBe(false);
  });
});
