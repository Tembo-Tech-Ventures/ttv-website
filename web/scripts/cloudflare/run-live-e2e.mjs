import { withPreviewFeedbackWriter } from "./preview-feedback-fixture.mjs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveAgentPreviewToken,
  deriveAgentPreviewPersonaToken,
  isAgentEnvironmentName,
} from "./agent-preview-auth.mjs";

export function resolvePlaywrightAgentToken(environment = process.env) {
  const personalAccessToken = environment.TTV_PERSONAL_ACCESS_TOKEN?.trim();
  if (personalAccessToken) return personalAccessToken;

  const explicitToken = environment.PLAYWRIGHT_AGENT_TOKEN?.trim();
  if (explicitToken) return explicitToken;

  const environmentName =
    environment.EXPECTED_DEPLOYMENT_ENVIRONMENT?.trim() ||
    environment.CLOUDFLARE_ENVIRONMENT_NAME?.trim();
  const previewSecret = environment.AGENT_PREVIEW_SECRET?.trim();
  if (
    environmentName &&
    isAgentEnvironmentName(environmentName) &&
    previewSecret
  ) {
    return deriveAgentPreviewToken(previewSecret, environmentName, environment.AGENT_PREVIEW_RUN_ID);
  }

  return undefined;
}

/** The browser variable each seeded preview persona's session token travels in. */
export const PERSONA_TOKEN_VARIABLES = Object.freeze({
  PLAYWRIGHT_NEW_STUDENT_TOKEN: "newStudent",
  PLAYWRIGHT_ACCEPTED_STUDENT_TOKEN: "acceptedStudent",
  PLAYWRIGHT_GRADUATE_STUDENT_TOKEN: "graduateStudent",
  PLAYWRIGHT_MENTOR_TOKEN: "mentor",
  PLAYWRIGHT_INSTITUTION_TOKEN: "institution",
});

export function resolvePlaywrightPersonaTokens(environment = process.env) {
  const environmentName =
    environment.EXPECTED_DEPLOYMENT_ENVIRONMENT?.trim() ||
    environment.CLOUDFLARE_ENVIRONMENT_NAME?.trim();
  const previewSecret = environment.AGENT_PREVIEW_SECRET?.trim();
  if (
    !environmentName ||
    !isAgentEnvironmentName(environmentName) ||
    !previewSecret
  ) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(PERSONA_TOKEN_VARIABLES).map(([variable, persona]) => [
      variable,
      deriveAgentPreviewPersonaToken(
        previewSecret,
        environmentName,
        persona,
        environment.AGENT_PREVIEW_RUN_ID
      ),
    ])
  );
}

/** Persona sessions exist only on agent previews; never inherit one elsewhere. */
function personaTokenEnvironment(environment) {
  return {
    ...Object.fromEntries(Object.keys(PERSONA_TOKEN_VARIABLES).map((variable) => [variable, ""])),
    ...resolvePlaywrightPersonaTokens(environment),
  };
}

export async function main(args = process.argv.slice(2), { environment = process.env, spawnImpl = spawn, withFeedbackWriter = withPreviewFeedbackWriter } = {}) {
  const token = resolvePlaywrightAgentToken(environment);
  const personaTokens = personaTokenEnvironment(environment);
  const binary = process.platform === "win32" ? "npx.cmd" : "npx";
  const launch = async feedbackToken => {
    const child = spawnImpl(binary, ["playwright", "test", ...args], {
      cwd: path.resolve(fileURLToPath(new URL("../..", import.meta.url))),
      env: {
        ...environment,
        PLAYWRIGHT_FEEDBACK_STUDENT_TOKEN: feedbackToken ?? "",
        ...(token ? { PLAYWRIGHT_AGENT_TOKEN: token } : {}),
        ...personaTokens,
      },
      stdio: "inherit",
    });

    return new Promise((resolve, reject) => {
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve();
        else reject(new Error(`Playwright exited with code ${code}.`));
      });
    });
  };
  if (!args.includes("--list") && isAgentEnvironmentName(environment.EXPECTED_DEPLOYMENT_ENVIRONMENT ?? "")) {
    return withFeedbackWriter({ environment, run: launch });
  }
  return launch();
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch(() => {
    console.error("Live browser verification failed; inspect test results and fixture cleanup status.");
    process.exitCode = 1;
  });
}
