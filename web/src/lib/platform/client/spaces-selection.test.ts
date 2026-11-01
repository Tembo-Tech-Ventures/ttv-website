import { describe, expect, it } from "vitest";
import { Intent, SPACE_ORDER, type SpaceId } from "../contracts";
import { meByPersona, onboardingByPersona } from "../fixtures";
import {
  LAST_SPACE_COOKIE, preferredSpace, readLastSpaceCookie, selectDefaultSpace, serializeLastSpaceCookie,
} from "./spaces-selection";

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

describe("preferred space from intents", () => {
  const everything: SpaceId[] = [...SPACE_ORDER];
  const memberOnly: SpaceId[] = ["community", "profile"];

  it.each<[string, Intent[], SpaceId[], SpaceId | null]>([
    ["mentoring outranks discover and cohort", ["MEMBER", "MENTOR", "INSTITUTION"], everything, "mentoring"],
    ["discover outranks cohort", ["INSTITUTION", "MEMBER"], everything, "discover"],
    ["a member goes to their cohort", ["MEMBER"], everything, "cohort"],
    ["intent order is not precedence", ["MEMBER", "INSTITUTION"], ["cohort", "community", "discover"], "discover"],
    ["an ungranted mentor preference is ignored", ["MENTOR"], memberOnly, "community"],
    ["an ungranted preference falls through to the next granted one", ["MENTOR", "MEMBER"], ["cohort", "community"], "cohort"],
    ["an ungranted institution preference is ignored", ["INSTITUTION"], ["community", "mentoring", "profile"], "community"],
    ["a member without a cohort lands in community", ["MEMBER"], memberOnly, "community"],
    ["exploring goes to community", ["EXPLORING"], everything, "community"],
    ["no intents is no preference", [], everything, null],
    ["community is never assumed", ["EXPLORING"], ["profile"], null],
    ["nothing held, nothing preferred", ["MENTOR"], [], null],
  ])("%s", (_name, intents, spaces, expected) => {
    expect(preferredSpace(intents, spaces)).toBe(expected);
  });

  it("only ever returns a held space and does not mutate its inputs", () => {
    const intentSets = [[], ...Intent.options.map(intent => [intent]), ["MEMBER", "MENTOR", "INSTITUTION"]] as Intent[][];
    for (const me of Object.values(meByPersona)) {
      for (const intents of intentSets) {
        const before = [...intents];
        const space = preferredSpace(intents, me.spaces);
        expect(space === null || me.spaces.includes(space)).toBe(true);
        expect(intents).toEqual(before);
      }
    }
  });

  it("sends the onboarding personas, who hold no new roles yet, to community", () => {
    for (const [name, state] of Object.entries(onboardingByPersona)) {
      const spaces = meByPersona[name as keyof typeof onboardingByPersona].spaces;
      expect(preferredSpace(state.intents, spaces)).toBe(state.intents.length === 0 ? null : "community");
    }
  });
});

describe("default selection with a preference", () => {
  it.each<[string, { explicitSpace?: unknown; lastSpace?: unknown; preferred?: unknown }, SpaceId | null]>([
    ["an explicit URL still wins", { explicitSpace: "profile", lastSpace: "community", preferred: "mentoring" }, "profile"],
    ["the cookie wins over the preference", { lastSpace: "community", preferred: "mentoring" }, "community"],
    ["the preference wins over contract order", { preferred: "mentoring" }, "mentoring"],
    ["an ungranted explicit URL falls to the cookie", { explicitSpace: "admin", lastSpace: "profile", preferred: "mentoring" }, "profile"],
    ["an ungranted cookie falls to the preference", { lastSpace: "admin", preferred: "mentoring" }, "mentoring"],
    ["an ungranted preference is ignored", { preferred: "discover" }, "community"],
    ["a malformed preference is ignored", { preferred: "mentoring; Path=/" }, "community"],
    ["a null preference uses contract order", { preferred: null }, "community"],
  ])("%s", (_name, options, expected) => {
    expect(selectDefaultSpace(meByPersona.mercy.spaces, options)).toBe(expected);
  });

  it("composes with preferredSpace for every persona and intent", () => {
    for (const me of Object.values(meByPersona)) {
      for (const intent of Intent.options) {
        const preferred = preferredSpace([intent], me.spaces);
        expect(selectDefaultSpace(me.spaces, { preferred })).toBe(preferred ?? me.spaces[0]);
        expect(selectDefaultSpace(me.spaces, { lastSpace: "profile", preferred })).toBe("profile");
      }
    }
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
