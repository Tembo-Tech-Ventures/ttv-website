import type { FieldOptionGroup } from "@/components/platform/ui";
import {
  PERSONAL_ACCESS_TOKEN_EXPIRY_OPTIONS,
  personalAccessTokenFamily,
  type PersonalAccessTokenScope,
  type PersonalAccessTokenSummary,
} from "@/lib/personal-access-tokens";

/*
 * How the admin's personal access tokens page words a token: the access it
 * gives, whether it still works, and the choices the form offers.
 */

export const TOKENS_PATH = "/admin/personal-access-tokens";

/** The form's access choices, by what they reach; read only comes first in each. */
export const TOKEN_ACCESS_OPTIONS: readonly FieldOptionGroup[] = [
  {
    group: "Admin",
    options: [
      { value: "read", label: "Admin: read only" },
      { value: "write", label: "Admin: read and write" },
    ],
  },
  {
    group: "Channels",
    options: [
      { value: "channels-read", label: "Channels: read only" },
      { value: "channels-write", label: "Channels: read and write" },
    ],
  },
];

/** How long a new token lasts: "1 day" to "12 months". */
export const TOKEN_EXPIRY_OPTIONS = PERSONAL_ACCESS_TOKEN_EXPIRY_OPTIONS.map(({ hours, label }) => ({ value: String(hours), label }));

/** What a token reaches, in words: "Admin, read only". */
export function tokenAccessLabel(scopes: readonly PersonalAccessTokenScope[]): string {
  const family = personalAccessTokenFamily([...scopes]);
  if (family === "admin") return scopes.includes("admin:write") ? "Admin, read and write" : "Admin, read only";
  if (family === "channels") return scopes.includes("channels:write") ? "Channels, read and write" : "Channels, read only";
  return "Community";
}

export type TokenStatus = "ACTIVE" | "EXPIRED" | "REVOKED";

/** Whether a token still works: revoked wins over expired. */
export function tokenStatus(token: Pick<PersonalAccessTokenSummary, "expiresAt" | "revokedAt">, now: Date): TokenStatus {
  if (token.revokedAt) return "REVOKED";
  return token.expiresAt <= now ? "EXPIRED" : "ACTIVE";
}

/** The confirm step's action for revoking one token. */
export function revokeAction(tokenId: string): string {
  return `revoke-${tokenId}`;
}
