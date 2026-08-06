import type { Database } from "@/lib/db/schema";
import { formSubmissionLog } from "@/lib/db/schema";
import { and, eq, gt, lt, count } from "drizzle-orm";

export const HONEYPOT_FIELD = "website_confirm";
export const FORM_TOKEN_FIELD = "_form_token";

const TOKEN_SEPARATOR = ".";
const MIN_FILL_SECONDS = 3;
const MAX_FILL_SECONDS = 7200;
const MAX_SUBMISSIONS_PER_HOUR = 5;
const CLEANUP_AGE_SECONDS = 86400;

async function hmacSign(
  secret: string,
  data: string
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(data)
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function timingSafeEqualHex(a: string, b: string): boolean {
  // Compare every character regardless of where the first mismatch occurs so
  // signature verification does not leak a timing side-channel.
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export async function issueFormToken(
  secret: string,
  now: number = Date.now()
): Promise<string> {
  const ts = Math.floor(now / 1000).toString();
  const sig = await hmacSign(secret, ts);
  return `${ts}${TOKEN_SEPARATOR}${sig}`;
}

export async function validateFormToken(
  secret: string,
  token: string,
  now: number = Date.now()
): Promise<boolean> {
  const sepIndex = token.indexOf(TOKEN_SEPARATOR);
  if (sepIndex === -1) return false;

  const ts = token.slice(0, sepIndex);
  const sig = token.slice(sepIndex + 1);
  const expected = await hmacSign(secret, ts);
  if (!timingSafeEqualHex(sig, expected)) return false;

  const age = Math.floor(now / 1000) - parseInt(ts, 10);
  return age >= MIN_FILL_SECONDS && age <= MAX_FILL_SECONDS;
}

export async function hashIp(secret: string, ip: string): Promise<string> {
  return hmacSign(secret, ip);
}

export async function checkAndRecordSubmission(
  db: Database,
  scope: string,
  ipHash: string,
  now: number = Date.now()
): Promise<boolean> {
  const nowSeconds = Math.floor(now / 1000);
  const hourAgo = new Date((nowSeconds - 3600) * 1000);
  const dayAgo = new Date((nowSeconds - CLEANUP_AGE_SECONDS) * 1000);

  try {
    const [result] = await db
      .select({ total: count() })
      .from(formSubmissionLog)
      .where(
        and(
          eq(formSubmissionLog.scope, scope),
          eq(formSubmissionLog.ipHash, ipHash),
          gt(formSubmissionLog.createdAt, hourAgo)
        )
      );

    if ((result?.total ?? 0) >= MAX_SUBMISSIONS_PER_HOUR) return false;

    await db.insert(formSubmissionLog).values({
      scope,
      ipHash,
    });

    db.delete(formSubmissionLog)
      .where(lt(formSubmissionLog.createdAt, dayAgo))
      .catch(() => {});

    return true;
  } catch (error) {
    console.error("Rate limit check failed, allowing submission:", error);
    return true;
  }
}

export type GuardResult =
  | { ok: true; silent: false }
  | { ok: true; silent: true }
  | { ok: false; reason: "token" | "rate_limit" };

export async function guardPublicForm({
  db,
  secret,
  scope,
  request,
  formData,
  now,
}: {
  db: Database;
  secret: string;
  scope: string;
  request: Request;
  formData: FormData;
  now?: number;
}): Promise<GuardResult> {
  const currentTime = now ?? Date.now();

  if (formData.get(HONEYPOT_FIELD)) {
    return { ok: true, silent: true };
  }

  const token = formData.get(FORM_TOKEN_FIELD) as string | null;
  if (!token || !(await validateFormToken(secret, token, currentTime))) {
    return { ok: false, reason: "token" };
  }

  const ip =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    "unknown";
  const ipHashed = await hashIp(secret, ip);
  const allowed = await checkAndRecordSubmission(
    db,
    scope,
    ipHashed,
    currentTime
  );
  if (!allowed) {
    return { ok: false, reason: "rate_limit" };
  }

  return { ok: true, silent: false };
}
