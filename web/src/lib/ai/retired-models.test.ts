import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMUNITY_CHAT_MODEL } from "@/lib/community/chat-agent";

/**
 * Workers AI models Cloudflare has retired. A retired model answers HTTP 410 with error code 5028,
 * and our callers turn that into a generic "could not answer", so the only signal used to be a
 * failing live e2e on every PR preview. Add each new retirement here when Cloudflare announces it
 * (https://developers.cloudflare.com/changelog/, Workers AI), before its date.
 */
const RETIRED_MODELS = new Map<string, string>(
  // Retired 2026-11-20: https://developers.cloudflare.com/changelog/post/2026-11-05-planned-model-deprecations/
  [
    "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b",
    "@cf/nvidia/nemotron-3-120b-a12b",
    "@cf/deepseek-ai/deepseek-v4-pro-0813",
    "@cf/deepseek-ai/deepseek-v4-flash-0731",
    "@cf/qwen/qwq-32b",
    "@cf/qwen/qwen3-30b-a3b-fp8",
    "@cf/moonshotai/kimi-k2.6",
    "@cf/moonshotai/kimi-k2.7-code",
    "@cf/zai-org/glm-5.2",
    "@cf/zai-org/glm-5.3-flash",
    "@cf/meta-llama/llama-2-7b-chat-hf-lora",
    "@cf/google/gemma-2b-it-lora",
    "@cf/google/gemma-7b-it-lora",
    "@cf/meta/llama-3.1-8b-instruct-fp8",
    "@cf/meta/llama-3.2-1b-instruct",
    "@cf/meta/llama-3.2-3b-instruct",
    "@cf/myshell-ai/melotts",
    "@cf/stabilityai/stable-diffusion-xl-base-1.0",
    "@cf/runwayml/stable-diffusion-v1-5-inpainting",
    "@cf/bytedance/stable-diffusion-xl-lightning",
    "@cf/lykon/dreamshaper-8-lcm",
    "@cf/openai/whisper-tiny-en",
    "@cf/llava-hf/llava-1.5-7b-hf",
    "@cf/google/embeddinggemma-300m",
  ].map((id): [string, string] => [id, "2026-11-20"]),
);

const WEB = resolve(import.meta.dirname, "../../..");
/** Everything that names a model the app or its deploy and test scripts run. */
const SCANNED = ["src", "scripts", "e2e", "wrangler.jsonc", "../.github/workflows"];
const SKIPPED_DIRS = new Set(["node_modules", "dist", ".astro", ".wrangler", "test-results"]);
const TEXT_FILE = /\.(?:[cm]?[jt]sx?|astro|jsonc?|ya?ml|toml|sql|md)$/;
const THIS_FILE = resolve(import.meta.filename);
// The id stops before a quote, a backtick or a space; `workers-ai/@cf/…` and `"@cf/…"` both match.
const MODEL_ID = /@cf\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+/g;

function files(path: string): string[] {
  if (!statSync(path, { throwIfNoEntry: false })) return [];
  if (statSync(path).isFile()) return TEXT_FILE.test(path) ? [path] : [];
  return readdirSync(path).flatMap((name) => (SKIPPED_DIRS.has(name) ? [] : files(join(path, name))));
}

/** Every `@cf/` model id in a text, with its line. */
function modelIds(text: string) {
  return text.split("\n").flatMap((line, index) => [...line.matchAll(MODEL_ID)].map(([id]) => ({ id, line: index + 1 })));
}

function retiredIn(text: string) {
  return modelIds(text).filter(({ id }) => RETIRED_MODELS.has(id.toLowerCase()));
}

describe("retired Workers AI models", () => {
  const scanned = SCANNED.flatMap((path) => files(resolve(WEB, path))).filter((file) => file !== THIS_FILE);
  const found = scanned.flatMap((file) =>
    modelIds(readFileSync(file, "utf8")).map((hit) => ({ ...hit, file: relative(WEB, file) })),
  );

  it("no source, script, e2e test or workflow names a retired model", () => {
    const retired = found
      .filter(({ id }) => RETIRED_MODELS.has(id.toLowerCase()))
      .map(({ file, line, id }) => `${file}:${line} ${id} (retired ${RETIRED_MODELS.get(id.toLowerCase())})`);
    expect(retired).toEqual([]);
  });

  it("reads the models the app really runs, so an empty scan cannot pass", () => {
    const ids = new Set(found.map(({ id }) => id));
    expect(ids).toContain(COMMUNITY_CHAT_MODEL);
    expect(ids).toContain("@cf/cloudflare/clef-flash");
    expect(ids).toContain("@cf/baai/bge-m3");
    expect(found.some(({ file }) => file.startsWith("scripts/"))).toBe(true);
    expect(found.some(({ file }) => file.startsWith("e2e/"))).toBe(true);
  });

  it.each([
    ['export const MODEL = "@cf/zai-org/glm-5.3-flash";', "@cf/zai-org/glm-5.3-flash"],
    ['const model = "workers-ai/@cf/meta/llama-3.2-3b-instruct";', "@cf/meta/llama-3.2-3b-instruct"],
    ["run(`@cf/Google/Gemma-7b-it-lora`, input)", "@cf/Google/Gemma-7b-it-lora"],
  ])("flags a retired id written as %s", (text, id) => {
    expect(retiredIn(text)).toEqual([{ id, line: 1 }]);
  });

  it.each([
    'const MODEL = "@cf/zai-org/glm-5.3";',
    'const MODEL = "@cf/google/gemma-4-26b-a4b-it";',
    'const MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";',
  ])("leaves a model that is still served alone: %s", (text) => {
    expect(retiredIn(text)).toEqual([]);
  });

  it("lists only well-formed, lower-case ids", () => {
    for (const id of RETIRED_MODELS.keys()) {
      expect(id).toBe(id.toLowerCase());
      expect([...id.matchAll(MODEL_ID)].map(([match]) => match)).toEqual([id]);
    }
    expect(RETIRED_MODELS.size).toBe(24);
  });
});
