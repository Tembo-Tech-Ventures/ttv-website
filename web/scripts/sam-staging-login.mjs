import { chmod, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Sign in to staging as a fictional persona with SAM's OIDC token (src/lib/sam-login/README.md).
 * Run it through SAM's exec_with_secrets with `oidc: { audience: "https://staging.tembotechventures.com" }`,
 * which puts a five-minute SAM_OIDC_TOKEN in this process only:
 *
 *   node scripts/sam-staging-login.mjs <persona> [--ttl=60] [--out=/tmp/ttv-sam-login]
 *   node scripts/sam-staging-login.mjs --revoke         # end your live logins, remove your newcomers
 *
 * Personas: newcomer, applicant, student, alumna, community, mentor, institution, admin.
 * The session cookie goes only into a Playwright storage-state file (<out>/<persona>.json,
 * readable by you alone); the script prints where it is, never the cookie itself. Each token
 * signs in once, so ask SAM for a new one per login. SAM_LOGIN_ORIGIN overrides the site.
 */

export const DEFAULT_ORIGIN = "https://staging.tembotechventures.com";
export const DEFAULT_OUT_DIR = "/tmp/ttv-sam-login";
const PERSONA = /^[a-z]+$/;

export function parseArguments(argv) {
  const options = { persona: null, revoke: false, ttlMinutes: undefined, outDir: DEFAULT_OUT_DIR };
  for (const argument of argv) {
    if (argument === "--revoke") options.revoke = true;
    else if (argument.startsWith("--ttl=")) options.ttlMinutes = Number(argument.slice("--ttl=".length));
    else if (argument.startsWith("--out=")) options.outDir = argument.slice("--out=".length);
    else if (!argument.startsWith("--") && !options.persona) options.persona = argument;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  if (options.revoke === Boolean(options.persona)) throw new Error("Give one persona to sign in as, or --revoke.");
  if (options.persona && !PERSONA.test(options.persona)) throw new Error(`Not a persona name: ${options.persona}`);
  if (options.ttlMinutes !== undefined && !Number.isInteger(options.ttlMinutes)) throw new Error("--ttl must be a whole number of minutes.");
  return options;
}

export function resolveToken(environment) {
  const token = environment.SAM_OIDC_TOKEN?.trim();
  if (!token || token.split(".").length !== 3) {
    throw new Error("SAM_OIDC_TOKEN is not set: run this through SAM's exec_with_secrets with an oidc audience of the staging origin.");
  }
  return token;
}

/** Signs in (or revokes) and returns what is safe to print; the cookie is written to a file only. */
export async function run(options, { environment = process.env, fetchImpl = fetch } = {}) {
  const origin = environment.SAM_LOGIN_ORIGIN?.trim() || DEFAULT_ORIGIN;
  const token = resolveToken(environment);
  const response = await fetchImpl(new URL("/api/staging/sam-login", origin), {
    method: options.revoke ? "DELETE" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    ...(options.revoke ? {} : { body: JSON.stringify({ persona: options.persona, ...(options.ttlMinutes === undefined ? {} : { ttlMinutes: options.ttlMinutes }) }) }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const hint = response.status === 404 ? " (SAM login is not enabled on this site, or the origin is wrong)" : "";
    throw new Error(`SAM login failed with ${response.status}${hint}: ${body.error ?? "no details"}`);
  }
  if (options.revoke) return { revoked: body.revoked, newcomersRemoved: body.newcomersRemoved, newcomersKept: body.newcomersKept };

  await mkdir(options.outDir, { recursive: true, mode: 0o700 });
  const file = path.join(options.outDir, `${options.persona}.json`);
  await writeFile(file, `${JSON.stringify({ cookies: body.cookies, origins: [] }, null, 2)}\n`, { mode: 0o600 });
  await chmod(file, 0o600);
  return {
    persona: body.persona,
    name: body.name,
    summary: body.summary,
    userId: body.userId,
    loginId: body.loginId,
    origin: body.origin,
    expiresAt: body.expiresAt,
    storageState: file,
  };
}

const invokedDirectly = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    console.log(JSON.stringify(await run(parseArguments(process.argv.slice(2))), null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
