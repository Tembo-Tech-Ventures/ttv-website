import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { URLSearchParams, fileURLToPath } from "node:url";

/**
 * Work the student feedback queue from a terminal or an agent session.
 *
 *   export TTV_FEEDBACK_TOKEN=ttv_pat_…      # admin PAT; read/write to update
 *                                            # (falls back to TTV_PERSONAL_ACCESS_TOKEN)
 *   node scripts/feedback.mjs list [--status=open|all|NEW,IN_PROGRESS] [--kind=BUG] [--limit=50] [--json]
 *   node scripts/feedback.mjs show <id> [--download=<dir>]
 *   node scripts/feedback.mjs claim <id> [--note=…]
 *   node scripts/feedback.mjs resolve <id> --response=… [--url=…] [--note=…]
 *   node scripts/feedback.mjs decline <id> --response=… [--note=…]
 *
 * `claim` only succeeds while the item is still NEW, so two agents on the
 * same queue cannot pick up the same note. `--response` is shown to the
 * student; `--note` is staff-only. TTV_BASE_URL defaults to production.
 */

export const DEFAULT_BASE_URL = "https://tembotechventures.com";
const TOKEN_PATTERN = /^ttv_pat_[a-f0-9]{64}$/;
const COMMANDS = new Set(["list", "show", "claim", "resolve", "decline"]);
const OPTIONS = {
  list: new Set(["status", "kind", "limit", "json"]),
  show: new Set(["download"]),
  claim: new Set(["note"]),
  resolve: new Set(["response", "url", "note"]),
  decline: new Set(["response", "note"]),
};

export class FeedbackCliError extends Error {}

export function parseFeedbackCliArgs(argv) {
  const [command, ...rest] = argv;
  if (!COMMANDS.has(command)) {
    throw new FeedbackCliError(
      `Usage: feedback.mjs <${[...COMMANDS].join("|")}> [id] [--option=value]`
    );
  }
  const positional = [];
  const options = {};
  for (const arg of rest) {
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const [name, ...valueParts] = arg.slice(2).split("=");
    if (!OPTIONS[command].has(name)) {
      throw new FeedbackCliError(`Unknown option for ${command}: --${name}`);
    }
    options[name] = valueParts.length > 0 ? valueParts.join("=") : true;
  }

  if (command === "list") {
    if (positional.length > 0) throw new FeedbackCliError("list takes no id.");
    return { command, options };
  }
  if (positional.length !== 1) {
    throw new FeedbackCliError(`${command} needs exactly one feedback id.`);
  }
  if ((command === "resolve" || command === "decline") && typeof options.response !== "string") {
    throw new FeedbackCliError(
      `${command} needs --response=… : the student sees it, so say what changed or why not.`
    );
  }
  return { command, id: positional[0], options };
}

/**
 * TTV_FEEDBACK_TOKEN wins so the queue can have its own read/write token;
 * otherwise the project's general (often read-only) admin token is used,
 * which is enough for list and show.
 */
const TOKEN_VARIABLES = ["TTV_FEEDBACK_TOKEN", "TTV_PERSONAL_ACCESS_TOKEN"];

export function resolveConfig(env) {
  const name = TOKEN_VARIABLES.find((variable) => env[variable]?.trim());
  const token = name ? env[name].trim() : "";
  if (!TOKEN_PATTERN.test(token)) {
    throw new FeedbackCliError(
      name
        ? `${name} is not an admin personal access token (ttv_pat_…). In a SAM workspace, run this through exec_with_secrets so the real value is injected.`
        : `Set ${TOKEN_VARIABLES.join(" or ")} to an admin personal access token (ttv_pat_…).`
    );
  }
  const baseUrl = new URL(env.TTV_BASE_URL?.trim() || DEFAULT_BASE_URL);
  const local = ["localhost", "127.0.0.1"].includes(baseUrl.hostname);
  if (baseUrl.protocol !== "https:" && !local) {
    throw new FeedbackCliError("TTV_BASE_URL must use HTTPS so the token is not sent in clear.");
  }
  return { token, baseUrl: baseUrl.origin };
}

/** Turns a parsed command into the API call it makes. */
export function buildFeedbackRequest({ command, id, options }) {
  const item = `/api/admin/feedback/${encodeURIComponent(id ?? "")}`;
  const patch = (body) => ({ method: "PATCH", path: item, body });
  const note = typeof options.note === "string" ? { adminNote: options.note } : {};

  switch (command) {
    case "list": {
      const query = new URLSearchParams();
      for (const key of ["status", "kind", "limit"]) {
        if (typeof options[key] === "string") query.set(key, options[key]);
      }
      const search = query.size > 0 ? `?${query}` : "";
      return { method: "GET", path: `/api/admin/feedback${search}` };
    }
    case "show":
      return { method: "GET", path: item };
    case "claim":
      return patch({ status: "IN_PROGRESS", expectedStatus: "NEW", ...note });
    case "resolve":
      return patch({
        status: "RESOLVED",
        response: options.response,
        ...(typeof options.url === "string" ? { resolutionUrl: options.url } : {}),
        ...note,
      });
    case "decline":
      return patch({ status: "DECLINED", response: options.response, ...note });
    default:
      throw new FeedbackCliError(`Unknown command: ${command}`);
  }
}

export function formatFeedbackList({ counts, items }) {
  const header = Object.entries(counts)
    .map(([status, count]) => `${status} ${count}`)
    .join(" · ");
  if (items.length === 0) return `${header}\n(no feedback matches)`;
  const lines = items.map((item) => {
    const firstLine = (item.message || "(screenshot only)").split("\n")[0];
    const text = firstLine.length > 100 ? `${firstLine.slice(0, 99)}…` : firstLine;
    const images = item.attachments.length > 0 ? ` [${item.attachments.length} img]` : "";
    const page = new URL(item.page.url).pathname;
    return `${item.id}  ${item.status.padEnd(11)} ${item.kind.padEnd(9)} ${page}${images}\n    ${text}`;
  });
  return [header, ...lines].join("\n");
}

const EXTENSIONS = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
};

async function call(fetchImpl, config, request) {
  const response = await fetchImpl(new URL(request.path, config.baseUrl), {
    method: request.method,
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/json",
      ...(request.body ? { "Content-Type": "application/json" } : {}),
    },
    body: request.body ? JSON.stringify(request.body) : undefined,
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { error: text.slice(0, 300) };
  }
  if (!response.ok) {
    const reason = body?.error ?? `HTTP ${response.status}`;
    throw new FeedbackCliError(`${request.method} ${request.path} failed (${response.status}): ${reason}`);
  }
  return body;
}

export async function downloadAttachments(fetchImpl, config, feedback, directory, write = writeFile) {
  await mkdir(directory, { recursive: true });
  const saved = [];
  for (const [index, attachment] of feedback.attachments.entries()) {
    // The bearer token only ever goes back to the site it came from.
    if (new URL(attachment.url).origin !== config.baseUrl) {
      throw new FeedbackCliError(`Refusing to send the token to ${attachment.url}.`);
    }
    const response = await fetchImpl(attachment.url, {
      headers: { Authorization: `Bearer ${config.token}` },
    });
    if (!response.ok) {
      throw new FeedbackCliError(`Could not download ${attachment.url} (${response.status}).`);
    }
    const file = path.join(
      directory,
      `${feedback.id}-${index + 1}.${EXTENSIONS[attachment.contentType] ?? "bin"}`
    );
    await write(file, new Uint8Array(await response.arrayBuffer()));
    saved.push(file);
  }
  return saved;
}

export async function runFeedbackCli(
  argv,
  { env = process.env, fetchImpl = fetch, log = console.log, write = writeFile } = {}
) {
  const parsed = parseFeedbackCliArgs(argv);
  const config = resolveConfig(env);
  const body = await call(fetchImpl, config, buildFeedbackRequest(parsed));

  if (parsed.command === "list" && parsed.options.json !== true) {
    log(formatFeedbackList(body));
    return body;
  }
  log(JSON.stringify(body, null, 2));
  if (parsed.command === "show" && typeof parsed.options.download === "string") {
    const files = await downloadAttachments(fetchImpl, config, body, parsed.options.download, write);
    for (const file of files) log(`saved ${file}`);
  }
  return body;
}

const isEntrypoint =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isEntrypoint) {
  runFeedbackCli(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof FeedbackCliError ? error.message : error);
    process.exitCode = 1;
  });
}
