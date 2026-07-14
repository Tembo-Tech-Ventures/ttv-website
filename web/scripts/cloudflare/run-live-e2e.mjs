import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  deriveAgentPreviewToken,
  isAgentEnvironmentName,
} from "./agent-preview-auth.mjs";

export function resolvePlaywrightAgentToken(environment = process.env) {
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
    return deriveAgentPreviewToken(previewSecret, environmentName);
  }

  return undefined;
}

export async function main(args = process.argv.slice(2)) {
  const token = resolvePlaywrightAgentToken();
  const binary = process.platform === "win32" ? "npx.cmd" : "npx";
  const child = spawn(binary, ["playwright", "test", ...args], {
    cwd: path.resolve(fileURLToPath(new URL("../..", import.meta.url))),
    env: {
      ...process.env,
      ...(token ? { PLAYWRIGHT_AGENT_TOKEN: token } : {}),
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
}

const isDirectRun =
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
