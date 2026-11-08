import type { AstroCookies } from "astro";

/*
 * A message that survives exactly one redirect: a form that saved answers
 * 303 to its page, and that page says "Saved" once. A query string such as
 * `?notice=saved` cannot do this: it stays in the address, so a reload says it
 * again and the next POST shows it beside a new error. The flash is a cookie
 * scoped to the page it redirects to, read and cleared by that page's next
 * GET. A failed submit never redirects: it renders again with its errors.
 */

/** What a flash may say. A failure is never one: the form renders again with its errors. */
export type FlashTone = "success" | "info" | "warning";

export type Flash = {
  tone: FlashTone;
  /** The point in a few words: "Cohort updated". */
  title?: string;
  /** What happened, when the title alone does not say it. */
  message?: string;
};

type FlashContext = { cookies: AstroCookies; url: URL };

export const FLASH_COOKIE = "ttv-flash";

const TONES: readonly FlashTone[] = ["success", "info", "warning"];
const MAX_TITLE = 120;
const MAX_MESSAGE = 400;

/**
 * Answers a successful POST: a 303 to `location` that carries `flash` to it.
 * `location` is a path on this site; the cookie is scoped to it, so no other
 * page, or other tab, reads it first.
 */
export function redirectWithFlash(context: FlashContext, location: string, flash: Flash): Response {
  const target = new URL(location, context.url);
  if (target.origin !== context.url.origin) throw new Error("A flash only travels to a page on this site.");
  if (!flash.title && !flash.message) throw new Error("A flash needs a title or a message.");
  context.cookies.set(FLASH_COOKIE, JSON.stringify({ ...flash, path: target.pathname }), {
    path: target.pathname,
    httpOnly: true,
    sameSite: "lax",
    secure: context.url.protocol === "https:",
    maxAge: 60,
  });
  return new Response(null, { status: 303, headers: { Location: `${target.pathname}${target.search}${target.hash}` } });
}

/**
 * The flash waiting for this page, once: reading it clears it. A cookie this
 * code did not write (or one a person edited) reads as nothing.
 */
export function takeFlash(context: FlashContext): Flash | null {
  const raw = context.cookies.get(FLASH_COOKIE)?.value;
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const path = isRecord(parsed) && typeof parsed.path === "string" ? parsed.path : context.url.pathname;
  context.cookies.delete(FLASH_COOKIE, { path });
  return isRecord(parsed) ? toFlash(parsed) : null;
}

function toFlash(value: Record<string, unknown>): Flash | null {
  const tone = TONES.find((candidate) => candidate === value.tone);
  const title = typeof value.title === "string" ? value.title.slice(0, MAX_TITLE) : undefined;
  const message = typeof value.message === "string" ? value.message.slice(0, MAX_MESSAGE) : undefined;
  if (!tone || (!title && !message)) return null;
  return { tone, ...(title && { title }), ...(message && { message }) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
