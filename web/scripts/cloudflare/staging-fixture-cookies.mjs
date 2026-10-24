import { createHmac } from "node:crypto";
import { getCookies } from "better-auth/cookies";
import { STAGING_FIXTURE_ORIGIN } from "./staging-fixture-target.mjs";

/** Matches pinned Better Auth/better-call signing; integration-tested, not a new auth protocol. */
export function createStagingBrowserCookies({ baseUrl, secret, token, expiresAt }) {
  const url = new URL(baseUrl);
  if (url.protocol !== "https:" || url.origin !== STAGING_FIXTURE_ORIGIN ||
      url.username || url.password || url.port || url.pathname !== "/" || url.search || url.hash ||
      typeof secret !== "string" || secret.length < 32 || !/^[a-f0-9]{64}$/.test(token) ||
      !Number.isSafeInteger(expiresAt) || expiresAt <= Date.now() / 1000 || expiresAt > Date.now() / 1000 + 3601) {
    throw new Error("Invalid staging browser fixture configuration.");
  }
  const definitions = getCookies({ baseURL: url.origin });
  return [[definitions.sessionToken, token], [definitions.dontRememberToken, "true"]].map(([cookie, value]) => ({
    name: cookie.name,
    value: encodeURIComponent(`${value}.${createHmac("sha256", secret).update(value).digest("base64")}`),
    domain: url.hostname,
    path: "/",
    expires: expiresAt,
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
  }));
}
