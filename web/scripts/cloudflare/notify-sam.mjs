import path from "node:path";
import { fileURLToPath } from "node:url";

const ALERT_KINDS = new Set(["deploy.failed", "rollback.failed"]);

function requireOption(options, name) {
  const value = options[name]?.trim();
  if (!value) {
    const argumentName = name.replaceAll(
      /[A-Z]/g,
      (match) => `-${match.toLowerCase()}`
    );
    throw new Error(`Missing required --${argumentName} argument.`);
  }
  return value;
}

function normalizeHttpUrl(value, label) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`${label} must use HTTP or HTTPS.`);
  }
  if (url.username || url.password) {
    throw new Error(`${label} must not include credentials.`);
  }
  return url.toString();
}

export function parseNotifySamArgs(args) {
  const options = {};
  for (const arg of args) {
    const [name, ...valueParts] = arg.split("=");
    const value = valueParts.join("=").trim();
    if (!value || !name.startsWith("--")) {
      throw new Error(`Invalid SAM notification argument: ${arg}`);
    }

    if (name === "--kind") options.kind = value;
    else if (name === "--environment") options.environmentName = value;
    else if (name === "--version") options.version = value;
    else if (name === "--run-id") options.runId = value;
    else if (name === "--run-attempt") options.runAttempt = value;
    else if (name === "--run-url") options.runUrl = value;
    else if (name === "--health-url") options.healthUrl = value;
    else if (name === "--message") options.message = value;
    else throw new Error(`Unknown SAM notification argument: ${name}`);
  }

  options.kind = requireOption(options, "kind");
  if (!ALERT_KINDS.has(options.kind)) {
    throw new Error(`Unsupported SAM deploy alert kind: ${options.kind}`);
  }
  options.environmentName = requireOption(options, "environmentName");
  if (options.environmentName !== "production") {
    throw new Error("SAM deploy failure notifications are restricted to production.");
  }
  options.version = requireOption(options, "version");
  options.runId = requireOption(options, "runId");
  options.runAttempt = requireOption(options, "runAttempt");
  options.runUrl = normalizeHttpUrl(
    requireOption(options, "runUrl"),
    "GitHub Actions run URL"
  );
  options.healthUrl = normalizeHttpUrl(
    requireOption(options, "healthUrl"),
    "Deployment health URL"
  );
  options.message = requireOption(options, "message").slice(0, 500);
  return options;
}

export function createSamAlertPayload(options, timestamp = new Date()) {
  const observedAt = timestamp.toISOString();
  return {
    source: "github-actions",
    kind: options.kind,
    environment: options.environmentName,
    version: options.version,
    count: 1,
    message: options.message.slice(0, 500),
    firstSeenAt: observedAt,
    lastSeenAt: observedAt,
    links: {
      health: options.healthUrl,
      run: options.runUrl,
    },
  };
}

export async function notifySam(
  options,
  {
    environment = process.env,
    fetchImpl = fetch,
    now = () => new Date(),
    log = console.log,
  } = {}
) {
  const webhookUrl = environment.SAM_ALERT_WEBHOOK_URL?.trim();
  const webhookToken = environment.SAM_ALERT_WEBHOOK_TOKEN?.trim();
  if (!webhookUrl || !webhookToken) {
    log(
      "::notice::SAM deploy alert skipped because SAM_ALERT_WEBHOOK_URL or SAM_ALERT_WEBHOOK_TOKEN is unset."
    );
    return { status: "skipped" };
  }

  const normalizedWebhookUrl = normalizeHttpUrl(webhookUrl, "SAM webhook URL");
  const payload = createSamAlertPayload(options, now());
  const idempotencyKey = `deploy.failed:${options.runId}:${options.runAttempt}`;
  const response = await fetchImpl(normalizedWebhookUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${webhookToken}`,
      "Content-Type": "application/json",
      "Idempotency-Key": idempotencyKey,
    },
    body: JSON.stringify(payload),
    signal: globalThis.AbortSignal.timeout(15_000),
  });

  if (response.status !== 202) {
    throw new Error(
      `SAM deploy alert delivery failed with HTTP ${response.status}.`
    );
  }

  log(`SAM accepted ${options.kind} alert for Actions run ${options.runId}.`);
  return { status: "delivered", idempotencyKey, payload };
}

async function main() {
  const options = parseNotifySamArgs(process.argv.slice(2));
  await notifySam(options);
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
