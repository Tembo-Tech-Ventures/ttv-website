import { describe, expect, it } from "vitest";
import { SPACE_ORDER, type SpaceId } from "../contracts";
import { meByPersona } from "../fixtures";
import { LAST_SPACE_COOKIE, readLastSpaceCookie, selectDefaultSpace, serializeLastSpaceCookie } from "./spaces-selection";

describe("shared server/client default selection", () => {
  it.each(Object.entries(meByPersona))("uses only %s's current membership and contract order", (_name, me) => {
    expect(selectDefaultSpace(me.spaces)).toBe(me.spaces[0]);
    for (const explicit of SPACE_ORDER) {
      for (const cookie of SPACE_ORDER) {
        const expected = me.spaces.includes(explicit) ? explicit : me.spaces.includes(cookie) ? cookie : me.spaces[0];
        expect(selectDefaultSpace(me.spaces, { explicitSpace: explicit, lastSpace: cookie })).toBe(expected);
      }
    }
  });

  it.each([undefined, null, "", "ADMIN", "admin ", "%61dmin", '"admin"', {}, ["admin"], "admin; Path=/"])(
    "rejects malformed candidates %j and falls back to the first authorized space", candidate => {
      expect(selectDefaultSpace(meByPersona.lucy.spaces, { explicitSpace: candidate, lastSpace: candidate })).toBe("community");
    },
  );

  it("handles empty authorization, revoked space and canonical ordering without mutating inputs", () => {
    expect(selectDefaultSpace([], { explicitSpace: "admin", lastSpace: "admin" })).toBeNull();
    const spaces: SpaceId[] = ["profile", "community"];
    expect(selectDefaultSpace(spaces, { lastSpace: "mentoring" })).toBe("community");
    expect(spaces).toEqual(["profile", "community"]);
    expect(selectDefaultSpace(meByPersona.lucy.spaces, { explicitSpace: "admin", lastSpace: "profile" })).toBe("profile");
  });
});

describe("plain last-space cookie", () => {
  it.each(SPACE_ORDER)("round-trips %s with the exact attributes", space => {
    const cookie = serializeLastSpaceCookie(space, true);
    expect(cookie).toBe(`${LAST_SPACE_COOKIE}=${space}; Path=/dashboard; SameSite=Lax; Max-Age=31536000; Secure`);
    expect(readLastSpaceCookie(cookie)).toBe(space);
    expect(serializeLastSpaceCookie(space, false)).not.toContain("Secure");
    expect(cookie).not.toContain("HttpOnly");
  });
  it("matches an exact name among unrelated cookies", () => {
    expect(readLastSpaceCookie("x=admin; ttv-last-space=profile; another=community")).toBe("profile");
    expect(readLastSpaceCookie("ttv-last-space-other=admin; not-ttv-last-space=admin")).toBeNull();
  });
  it.each([undefined, null, "", "ttv-last-space", "ttv-last-space=", "ttv-last-space=%70rofile", 'ttv-last-space="profile"',
    "ttv-last-space=admin=community", "ttv-last-space=admin; ttv-last-space=profile", "ttv-last-space=admin; ttv-last-space=admin"])(
    "ignores malformed, encoded and ambiguous values %j", header => expect(readLastSpaceCookie(header)).toBeNull(),
  );
  it("validates serialized data rather than allowing cookie injection", () => {
    expect(() => serializeLastSpaceCookie("profile; HttpOnly" as SpaceId, true)).toThrow(/Invalid option/);
  });
});
