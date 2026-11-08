import { describe, expect, it } from "vitest";
import {
  PERSONAL_ACCESS_TOKEN_DURATIONS,
  PersonalAccessTokenInputError,
  normalizePersonalAccessTokenLabel,
  parsePersonalAccessTokenDuration,
  parsePersonalAccessTokenScopes,
} from "@/lib/personal-access-tokens";
import { TOKEN_ACCESS_OPTIONS, TOKEN_EXPIRY_OPTIONS, revokeAction, tokenAccessLabel, tokenStatus } from "./tokens";

const NOW = new Date("2026-11-08T12:00:00Z");

describe("how the tokens page words a token", () => {
  it("offers every access the store accepts, read only first in each group", () => {
    for (const { options } of TOKEN_ACCESS_OPTIONS) {
      expect(options[0].label).toMatch(/read only$/);
      for (const { value } of options) expect(parsePersonalAccessTokenScopes(value).length).toBeGreaterThan(0);
    }
    for (const { value } of TOKEN_EXPIRY_OPTIONS) expect(PERSONAL_ACCESS_TOKEN_DURATIONS).toContain(parsePersonalAccessTokenDuration(value));
  });

  it("says what a token reaches in words", () => {
    expect(tokenAccessLabel(["admin:read"])).toBe("Admin, read only");
    expect(tokenAccessLabel(["admin:read", "admin:write"])).toBe("Admin, read and write");
    expect(tokenAccessLabel(["channels:read"])).toBe("Channels, read only");
    expect(tokenAccessLabel(["channels:read", "channels:write"])).toBe("Channels, read and write");
    expect(tokenAccessLabel(["community:read"])).toBe("Community");
  });

  it("says whether it still works: revoked wins over expired, and expiry is reached at its moment", () => {
    expect(tokenStatus({ expiresAt: new Date("2026-11-09T00:00:00Z"), revokedAt: null }, NOW)).toBe("ACTIVE");
    expect(tokenStatus({ expiresAt: NOW, revokedAt: null }, NOW)).toBe("EXPIRED");
    expect(tokenStatus({ expiresAt: new Date("2026-11-01T00:00:00Z"), revokedAt: new Date("2026-10-30T00:00:00Z") }, NOW)).toBe("REVOKED");
    expect(revokeAction("token-1")).toBe("revoke-token-1");
  });
});

describe("a refused token request", () => {
  it("is an input error naming the field it is about, so the page answers 400 under that field", () => {
    const refusal = (run: () => unknown) => {
      try {
        run();
      } catch (caught) {
        return caught;
      }
      return null;
    };
    expect(refusal(() => normalizePersonalAccessTokenLabel("  "))).toMatchObject({ name: "PersonalAccessTokenInputError", field: "label" });
    expect(refusal(() => parsePersonalAccessTokenDuration("5"))).toMatchObject({ field: "duration" });
    expect(refusal(() => parsePersonalAccessTokenScopes("everything"))).toBeInstanceOf(PersonalAccessTokenInputError);
    expect(refusal(() => parsePersonalAccessTokenScopes("everything"))).toMatchObject({ field: "access" });
  });
});
