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
 *   node scripts/feedback.mjs sensitive <id> [--note=…]     # personal content: off themes, out of public
 *
 * Themes group notes into one problem or wish (titles and summaries may be
 * published, so never identify a student):
 *
 *   node scripts/feedback.mjs list --untriaged              # notes nobody has sorted yet
 *   node scripts/feedback.mjs themes [--status=open|all|COLLECTING,…] [--json]
 *   node scripts/feedback.mjs theme <id>
 *   node scripts/feedback.mjs theme-create --title=… --kind=IDEA [--summary=…] [--change=FIX|SIMPLIFY|ADD]
 *   node scripts/feedback.mjs attach <noteId> <themeId>
 *   node scripts/feedback.mjs detach <noteId>
 *   node scripts/feedback.mjs theme-update <id> [--status=…] [--title=…] [--summary=…] [--kind=…]
 *       [--change=…] [--issue=<url>] [--pr=<url>] [--note=…] [--message=…]
 *
 * Shipping or declining a theme needs --message: it becomes the reply on every
 * open note on it.
 *
 * `claim` only succeeds while the item is still NEW, so two agents on the
 * same queue cannot pick up the same note. `--response` is shown to the
 * student; `--note` is staff-only. TTV_BASE_URL defaults to production.
 */

export const DEFAULT_BASE_URL = "https://tembotechventures.com";
const TOKEN_PATTERN = /^ttv_pat_[a-f0-9]{64}$/;
/** Each command's positional arguments, options, and required options. */
const COMMANDS = {
  list: { args: [], options: ["status", "kind", "limit", "json", "untriaged", "theme"] },
  show: { args: ["id"], options: ["download"] },
  claim: { args: ["id"], options: ["note"] },
  resolve: { args: ["id"], options: ["response", "url", "note"], required: ["response"] },
  decline: { args: ["id"], options: ["response", "note"], required: ["response"] },
  sensitive: { args: ["id"], options: ["note"] },
  themes: { args: [], options: ["status", "json"] },
  theme: { args: ["id"], options: [] },
  "theme-create": {
    args: [],
    options: ["title", "kind", "summary", "change"],
    required: ["title", "kind"],
  },
  attach: { args: ["id", "themeId"], options: [] },
  detach: { args: ["id"], options: [] },
  "theme-update": {
    args: ["id"],
    options: ["status", "title", "summary", "kind", "change", "issue", "pr", "note", "message"],
  },
};

const REQUIRED_HINTS = {
  response: "the student sees it, so say what changed or why not",
  title: "titles may be published, so never identify a student",
  kind: "BUG, CONFUSING, IDEA, PRAISE or OTHER",
};

export class FeedbackCliError extends Error {}

export function parseFeedbackCliArgs(argv) {
  const [command, ...rest] = argv;
  const spec = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : null;
  if (!spec) {
    throw new FeedbackCliError(
      `Usage: feedback.mjs <${Object.keys(COMMANDS).join("|")}> [ids] [--option=value]`
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
    if (!spec.options.includes(name)) {
      throw new FeedbackCliError(`Unknown option for ${command}: --${name}`);
    }
    options[name] = valueParts.length > 0 ? valueParts.join("=") : true;
  }

  if (positional.length !== spec.args.length) {
    throw new FeedbackCliError(
      spec.args.length === 0
        ? `${command} takes no id.`
        : `${command} needs ${spec.args.length === 1 ? "exactly one id" : spec.args.join(" and ")}.`
    );
  }
  for (const name of spec.required ?? []) {
    if (typeof options[name] !== "string") {
      throw new FeedbackCliError(`${command} needs --${name}=… : ${REQUIRED_HINTS[name]}.`);
    }
  }
  const ids = Object.fromEntries(spec.args.map((name, index) => [name, positional[index]]));
  return { command, ...ids, options };
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
export function buildFeedbackRequest({ command, id, themeId, options }) {
  const item = `/api/admin/feedback/${encodeURIComponent(id ?? "")}`;
  const themePath = `/api/admin/feedback/themes/${encodeURIComponent(id ?? "")}`;
  const patch = (body, target = item) => ({ method: "PATCH", path: target, body });
  const note = typeof options.note === "string" ? { adminNote: options.note } : {};
  const query = (keys, rename = {}) => {
    const params = new URLSearchParams();
    for (const key of keys) {
      if (typeof options[key] === "string") params.set(rename[key] ?? key, options[key]);
      if (options[key] === true) params.set(rename[key] ?? key, "1");
    }
    return params.size > 0 ? `?${params}` : "";
  };

  switch (command) {
    case "list":
      return {
        method: "GET",
        path: `/api/admin/feedback${query(["status", "kind", "limit", "untriaged", "theme"], { theme: "themeId" })}`,
      };
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
    case "sensitive":
      return patch({ sensitive: true, ...note });
    case "attach":
      return patch({ themeId });
    case "detach":
      return patch({ themeId: null });
    case "themes":
      return { method: "GET", path: `/api/admin/feedback/themes${query(["status"])}` };
    case "theme":
      return { method: "GET", path: themePath };
    case "theme-create":
      return {
        method: "POST",
        path: "/api/admin/feedback/themes",
        body: {
          title: options.title,
          kind: options.kind,
          ...(typeof options.summary === "string" ? { summary: options.summary } : {}),
          ...(typeof options.change === "string" ? { change: options.change } : {}),
        },
      };
    case "theme-update": {
      const fields = {
        status: "status",
        title: "title",
        summary: "summary",
        kind: "kind",
        change: "change",
        issue: "issueUrl",
        pr: "prUrl",
        note: "decisionNote",
        message: "studentMessage",
      };
      const body = {};
      for (const [option, field] of Object.entries(fields)) {
        if (typeof options[option] === "string") body[field] = options[option];
      }
      if (Object.keys(body).length === 0) {
        throw new FeedbackCliError("theme-update needs at least one option to change.");
      }
      return patch(body, themePath);
    }
    default:
      throw new FeedbackCliError(`Unknown command: ${command}`);
  }
}

export function formatThemeList({ items }) {
  if (items.length === 0) return "(no themes match)";
  return items
    .map((theme) => {
      const { students, recentStudents } = theme.stats;
      const flag = theme.assessment.readyToPropose ? "  READY" : "";
      return `${theme.id}  ${theme.status.padEnd(11)} ${theme.kind.padEnd(9)} ${students} students (${recentStudents} recent)${flag}\n    ${theme.title}\n    ${theme.assessment.reason}`;
    })
    .join("\n");
}

export function formatFeedbackList({ counts, items }) {
  const header = Object.entries(counts)
    .map(([status, count]) => `${status} ${count}`)
    .join(" · ");
  if (items.length === 0) return `${header}\n(no feedback matches)`;
  const lines = items.map((item) => {
    const firstLine = (item.message || "(screenshot only)").split("\n")[0];
    const theme = item.theme ? ` → ${item.theme.title}` : item.sensitive ? " [sensitive]" : "";
    const text = firstLine.length > 100 ? `${firstLine.slice(0, 99)}…` : firstLine;
    const images = item.attachments.length > 0 ? ` [${item.attachments.length} img]` : "";
    const page = new URL(item.page.url).pathname;
    return `${item.id}  ${item.status.padEnd(11)} ${item.kind.padEnd(9)} ${page}${images}${theme}\n    ${text}`;
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
  if (parsed.command === "themes" && parsed.options.json !== true) {
    log(formatThemeList(body));
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
