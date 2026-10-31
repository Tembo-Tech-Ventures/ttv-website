import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Avatar, { avatarFill, avatarFillIndex, initialsOf } from "./Avatar";
import PersonMarker from "./PersonMarker";
import RoleBadge, { clipLabel, ROLE_BADGE_KINDS, ROLE_BADGE_MAX_CHARS } from "./RoleBadge";
import TemboMark from "./TemboMark";
import { AVATAR_FILLS } from "./tokens";

const html = renderToStaticMarkup;

describe("Avatar colour", () => {
  it("is a pure function of the id, never of position in a list", () => {
    const ids = ["usr_a", "usr_b", "usr_c", "usr_d"];
    const forwards = ids.map(avatarFill);
    const backwards = ids.toReversed().map(avatarFill).toReversed();
    expect(backwards).toEqual(forwards);
    expect(avatarFill("usr_a")).toBe(avatarFill("usr_a"));
  });

  it("always lands inside the palette, for any id", () => {
    for (const id of ["", "x", "🐘", "a".repeat(500), "usr_fx_wanjiku", "Kim Possible 07"]) {
      const index = avatarFillIndex(id);
      expect(Number.isInteger(index)).toBe(true);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(AVATAR_FILLS.length);
    }
  });

  it("spreads people across every fill", () => {
    const used = new Set(Array.from({ length: 200 }, (_, i) => avatarFillIndex(`user-${i}`)));
    expect(used.size).toBe(AVATAR_FILLS.length);
  });

  it("is pinned for known ids, so a refactor cannot quietly re-colour everyone", () => {
    // Published FNV-1a 32-bit vectors.
    expect(avatarFillIndex("")).toBe(0x811c9dc5 % AVATAR_FILLS.length);
    expect(avatarFillIndex("a")).toBe(0xe40c292c % AVATAR_FILLS.length);
    expect(avatarFillIndex("foobar")).toBe(0xbf9cf968 % AVATAR_FILLS.length);
  });
});

describe("initialsOf", () => {
  it.each([
    ["Wanjiku Mwangi", "WM"],
    ["Achieng Atieno Otieno", "AO"],
    ["tembo", "T"],
    ["  david   kamau ", "DK"],
    ["", "?"],
    ["   ", "?"],
    ["Ölund Ärna", "ÖÄ"],
    ["😀 Smile", "😀S"],
  ])("%s → %s", (name, initials) => {
    expect(initialsOf(name)).toBe(initials);
  });
});

describe("Avatar", () => {
  it("names the person once, on the disc, when there is no photo", () => {
    const markup = html(<Avatar id="usr_1" name="Wanjiku Mwangi" />);
    expect(markup).toContain('role="img"');
    expect(markup).toContain('aria-label="Wanjiku Mwangi"');
    expect(markup).toContain('<span aria-hidden="true">WM</span>');
  });

  it("names the person on the photo's alt text, not twice", () => {
    const markup = html(<Avatar id="usr_1" name="Lucy Chebet" src="/lucy.png" />);
    expect(markup).toContain('alt="Lucy Chebet"');
    expect(markup).not.toContain('role="img"');
    expect(markup).not.toContain("aria-label");
    expect(markup).toContain('loading="lazy"');
  });

  it("names nobody when decorative, with or without a photo", () => {
    const initials = html(<Avatar id="usr_1" name="Lucy Chebet" decorative />);
    expect(initials).toContain('aria-hidden="true"');
    expect(initials).not.toContain("aria-label");
    const photo = html(<Avatar id="usr_1" name="Lucy Chebet" src="/lucy.png" decorative />);
    expect(photo).toContain('alt=""');
  });

  it("treats an empty photo URL as no photo", () => {
    expect(html(<Avatar id="usr_1" name="Lucy Chebet" src="" />)).toContain('role="img"');
    expect(html(<Avatar id="usr_1" name="Lucy Chebet" src={null} />)).not.toContain("<img");
  });

  it.each([
    ["xs", "size-[18px]"],
    ["sm", "size-6"],
    ["md", "size-[34px]"],
    ["lg", "size-12"],
    ["xl", "size-16"],
  ] as const)("has a %s size", (size, cls) => {
    expect(html(<Avatar id="u" name="A B" size={size} />)).toContain(cls);
  });

  it("uses its id's fill and dark teal initials", () => {
    const markup = html(<Avatar id="usr_x" name="A B" />);
    expect(markup).toContain(avatarFill("usr_x"));
    expect(markup).toContain("text-dark");
  });

  it("rings mentors in teal, with a gap in the surface colour", () => {
    const markup = html(<Avatar id="u" name="Mercy Wambui" marker="mentor" />);
    expect(markup).toContain('data-marker="mentor"');
    expect(markup).toContain("var(--color-ring)");
    expect(markup).toContain("var(--pf-surface,var(--color-ground))");
  });

  it("marks builders with a peach dot and institutions with a diamond, both decorative", () => {
    expect(html(<Avatar id="u" name="B K" marker="builder" />)).toMatch(
      /aria-hidden="true" data-corner-marker="builder" class="[^"]*bg-primary/
    );
    expect(html(<Avatar id="u" name="J M" marker="institution" />)).toMatch(
      /aria-hidden="true" data-corner-marker="institution" class="[^"]*rotate-45/
    );
    expect(html(<Avatar id="u" name="J M" />)).not.toContain("data-corner-marker");
  });
});

describe("PersonMarker", () => {
  it.each([
    ["builder", "rounded-full bg-primary"],
    ["mentor", "border-ring"],
    ["institution", "rotate-45"],
    ["staff", "border-primary"],
  ] as const)("draws %s from the network's shapes", (kind, cls) => {
    expect(html(<PersonMarker kind={kind} />)).toContain(cls);
  });

  it("draws community as a builder and a mentor together", () => {
    const markup = html(<PersonMarker kind="community" />);
    expect(markup).toContain("bg-primary");
    expect(markup).toContain("border-ring");
  });

  it("is decoration beside a word, and an image when it stands alone", () => {
    expect(html(<PersonMarker kind="mentor" />)).toContain('aria-hidden="true"');
    const named = html(<PersonMarker kind="mentor" label="Mentor" />);
    expect(named).toContain('role="img"');
    expect(named).toContain('aria-label="Mentor"');
    expect(named).not.toContain("aria-hidden");
  });
});

describe("TemboMark", () => {
  it("is Tembo's T in the display face, peach on deep teal in a peach ring", () => {
    const markup = html(<TemboMark />);
    expect(markup).toContain("font-heading");
    expect(markup).toContain("bg-dark");
    expect(markup).toContain("text-primary");
    expect(markup).toContain("ring-primary");
    expect(markup).toContain(">T<");
  });

  it("is named Tembo unless the name is written beside it", () => {
    expect(html(<TemboMark />)).toContain('aria-label="Tembo"');
    const decorative = html(<TemboMark decorative />);
    expect(decorative).toContain('aria-hidden="true"');
    expect(decorative).not.toContain("aria-label");
  });
});

describe("RoleBadge", () => {
  it("renders every contract kind with its label", () => {
    for (const kind of ROLE_BADGE_KINDS) {
      const markup = html(<RoleBadge kind={kind} label={`${kind} label`} />);
      expect(markup).toContain(`data-role-badge="${kind}"`);
      expect(markup).toContain(`${kind} label`);
    }
  });

  it("gives mentors the teal ring and institutions the diamond", () => {
    expect(html(<RoleBadge kind="MENTOR" label="Mentor" />)).toContain("text-ring");
    expect(html(<RoleBadge kind="MENTOR" label="Mentor" />)).toContain('data-marker="mentor"');
    expect(html(<RoleBadge kind="INSTITUTION" label="Institution" />)).toContain('data-marker="institution"');
    expect(html(<RoleBadge kind="COHORT" label="Cohort 04" />)).not.toContain("data-marker");
  });

  it("draws Tembo's AI badge in peach ink", () => {
    expect(html(<RoleBadge kind="AI" label="AI" />)).toContain("text-peach-ink");
  });

  it("cuts an over-long label but keeps it whole in the tooltip", () => {
    const long = "Alumni · Cohort 02 · Nairobi evening track";
    const markup = html(<RoleBadge kind="ALUMNI" label={long} />);
    expect(markup).toContain(`title="${long}"`);
    expect(markup).toContain(`${clipLabel(long)}</span>`);
    expect(Array.from(clipLabel(long))).toHaveLength(ROLE_BADGE_MAX_CHARS);
    expect(html(<RoleBadge kind="COHORT" label="Cohort 04" />)).not.toContain("title=");
  });

  it("clips by character, not by UTF-16 unit", () => {
    expect(clipLabel("🐘".repeat(40))).toBe(`${"🐘".repeat(ROLE_BADGE_MAX_CHARS - 1)}…`);
    expect(clipLabel("  Cohort 04  ")).toBe("Cohort 04");
  });
});
