import { describe, expect, it, vi } from "vitest";
import { FlagKey, type Flag, type FlagAudience } from "@/lib/platform/contracts";
import {
  CHANGE_NOTICE_WINDOW_MS, CONFIRM_ALL, FLAG_DETAILS, FLAG_ORDER, changeNotice, changedByNames, dependencyWarnings, flagsOverridden, isFreshChange, lastChanged, parseFlagForm,
} from "./platform-flags";

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

/** Every flag OFF, with the given ones set. */
function audiences(set: Partial<Record<FlagKey, FlagAudience>>): Pick<Flag, "key" | "audience">[] {
  return FlagKey.options.map((key) => ({ key, audience: set[key] ?? "OFF" }));
}

describe("dependencyWarnings", () => {
  it("warns when onboarding reaches more people than spaces", () => {
    expect(dependencyWarnings(audiences({ onboarding: "STAFF" }))).toEqual([{
      key: "onboarding",
      requires: "spaces",
      message: "Onboarding needs Spaces, which is Off. Set Spaces to Staff too, or Onboarding won't work for everyone it is set for.",
    }]);
    expect(dependencyWarnings(audiences({ spaces: "STAFF", onboarding: "ALL" }))).toEqual([
      expect.objectContaining({ key: "onboarding", requires: "spaces", message: expect.stringContaining("which is Staff. Set Spaces to Everyone too") }),
    ]);
  });

  it("warns for each channel feature set wider than channels", () => {
    const warnings = dependencyWarnings(audiences({ channels: "STAFF", tembo_channels: "ALL", mentor_requests: "ALL" }));
    expect(warnings.map(({ key, requires }) => [key, requires])).toEqual([
      ["tembo_channels", "channels"],
      ["mentor_requests", "channels"],
    ]);
  });

  it("is quiet when each flag reaches no more people than the flag it needs", () => {
    expect(dependencyWarnings(audiences({}))).toEqual([]);
    expect(dependencyWarnings(audiences({ spaces: "STAFF", onboarding: "STAFF" }))).toEqual([]);
    expect(dependencyWarnings(audiences({ spaces: "ALL", onboarding: "STAFF", channels: "ALL", tembo_channels: "ALL" }))).toEqual([]);
    // The flag something needs may always go further than what needs it.
    expect(dependencyWarnings(audiences({ spaces: "ALL", channels: "STAFF" }))).toEqual([]);
  });

  it("never warns about flags with nothing to depend on", () => {
    const warned = dependencyWarnings(audiences({ spaces: "ALL", channels: "ALL", onboarding: "ALL", tembo_channels: "ALL", mentor_requests: "ALL" }));
    expect(warned).toEqual([]);
    expect(dependencyWarnings(audiences({ spaces: "ALL" }))).toEqual([]);
  });
});

describe("parseFlagForm", () => {
  it("applies Off and Staff at once", () => {
    expect(parseFlagForm(form({ key: "spaces", audience: "STAFF" }))).toEqual({ ok: true, key: "spaces", audience: "STAFF", needsConfirmation: false });
    expect(parseFlagForm(form({ key: "onboarding", audience: "OFF" }))).toEqual({ ok: true, key: "onboarding", audience: "OFF", needsConfirmation: false });
  });

  it("asks before Everyone, unless the confirmation came with it", () => {
    expect(parseFlagForm(form({ key: "spaces", audience: "ALL" }))).toMatchObject({ ok: true, needsConfirmation: true });
    expect(parseFlagForm(form({ key: "spaces", audience: "ALL", confirm: "yes" }))).toMatchObject({ ok: true, needsConfirmation: true });
    expect(parseFlagForm(form({ key: "spaces", audience: "ALL", confirm: CONFIRM_ALL }))).toMatchObject({ ok: true, needsConfirmation: false });
  });

  it("refuses unknown flags and settings", () => {
    expect(parseFlagForm(form({ key: "everything", audience: "STAFF" }))).toMatchObject({ ok: false });
    expect(parseFlagForm(form({ key: "spaces", audience: "on" }))).toMatchObject({ ok: false });
    expect(parseFlagForm(form({ audience: "STAFF" }))).toMatchObject({ ok: false });
  });
});

describe("what the page says", () => {
  it("lists every flag once, each after the flag it needs", () => {
    expect(FLAG_ORDER.toSorted()).toEqual(FlagKey.options.toSorted());
    expect(FLAG_ORDER.indexOf("onboarding")).toBeGreaterThan(FLAG_ORDER.indexOf("spaces"));
    expect(FLAG_ORDER.indexOf("tembo_channels")).toBeGreaterThan(FLAG_ORDER.indexOf("channels"));
    expect(FLAG_ORDER.indexOf("mentor_requests")).toBeGreaterThan(FLAG_ORDER.indexOf("channels"));
    for (const key of FlagKey.options) expect(FLAG_DETAILS[key].description.length).toBeGreaterThan(20);
  });

  it("names the setting and who it reaches", () => {
    expect(changeNotice({ key: "spaces", audience: "STAFF" })).toBe("Spaces is now Staff: administrators only.");
    expect(changeNotice({ key: "tembo_channels", audience: "ALL" })).toBe("Tembo in channels is now Everyone: every signed-in user.");
    expect(changeNotice({ key: "onboarding", audience: "OFF" })).toBe("Onboarding is now Off: no one.");
  });

  it("says when and by whom a flag last changed, in Nairobi time", () => {
    const names = new Map([["user-amina", "Amina Hassan"]]);
    const at = Date.UTC(2026, 10, 1, 13, 30);
    expect(lastChanged({ updatedAt: at, updatedBy: "user-amina" }, names)).toBe("Changed 1 Nov 2026, 16:30 Nairobi time by Amina Hassan.");
    expect(lastChanged({ updatedAt: at, updatedBy: null }, names)).toBe("Changed 1 Nov 2026, 16:30 Nairobi time. No administrator recorded.");
    expect(lastChanged({ updatedAt: at, updatedBy: "user-unnamed" }, names)).toMatch(/by an administrator with no name on their account\.$/);
    expect(lastChanged({ updatedAt: 0, updatedBy: null }, names)).toBe("Never changed.");
  });
});

describe("isFreshChange", () => {
  const now = Date.UTC(2026, 10, 1, 14, 0);

  it("announces a change made moments ago, allowing for clock skew", () => {
    expect(isFreshChange({ updatedAt: now - 2_000 }, now)).toBe(true);
    expect(isFreshChange({ updatedAt: now - CHANGE_NOTICE_WINDOW_MS }, now)).toBe(true);
    expect(isFreshChange({ updatedAt: now + 1_000 }, now)).toBe(true);
  });

  it("stays quiet on a reload or bookmark long after, and for a flag never changed", () => {
    expect(isFreshChange({ updatedAt: now - CHANGE_NOTICE_WINDOW_MS - 1 }, now)).toBe(false);
    expect(isFreshChange({ updatedAt: now - 86_400_000 }, now)).toBe(false);
    expect(isFreshChange({ updatedAt: 0 }, now)).toBe(false);
  });
});

describe("changedByNames", () => {
  it("reads each editor once, and skips blank names", async () => {
    const all = vi.fn().mockResolvedValue({ results: [{ id: "user-amina", name: "Amina Hassan" }, { id: "user-blank", name: "  " }] });
    const bind = vi.fn().mockReturnValue({ all });
    const prepare = vi.fn().mockReturnValue({ bind });
    const names = await changedByNames({ prepare } as unknown as D1Database, [
      { updatedBy: "user-amina" }, { updatedBy: "user-amina" }, { updatedBy: "user-blank" }, { updatedBy: null },
    ]);
    expect(prepare).toHaveBeenCalledWith("SELECT id, name FROM user WHERE id IN (?, ?)");
    expect(bind).toHaveBeenCalledWith("user-amina", "user-blank");
    expect([...names]).toEqual([["user-amina", "Amina Hassan"]]);
  });

  it("asks nothing when no administrator is recorded", async () => {
    const prepare = vi.fn();
    expect(await changedByNames({ prepare } as unknown as D1Database, [{ updatedBy: null }])).toEqual(new Map());
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe("flagsOverridden", () => {
  it("is true only where the override applies, never in production", () => {
    expect(flagsOverridden({ DEPLOYMENT_ENVIRONMENT: "agent-pr-280", PLATFORM_FLAGS_OVERRIDE: "all" })).toBe(true);
    expect(flagsOverridden({ DEPLOYMENT_ENVIRONMENT: "staging", PLATFORM_FLAGS_OVERRIDE: undefined })).toBe(false);
    expect(flagsOverridden({ DEPLOYMENT_ENVIRONMENT: "production", PLATFORM_FLAGS_OVERRIDE: "all" })).toBe(false);
    expect(flagsOverridden({ DEPLOYMENT_ENVIRONMENT: " Production ", PLATFORM_FLAGS_OVERRIDE: "all" })).toBe(false);
  });
});
