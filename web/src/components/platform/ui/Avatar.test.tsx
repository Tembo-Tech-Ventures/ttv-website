import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Avatar from "./Avatar";
import { AVATAR_PALETTE, avatarColour, initials } from "./avatar-colour";
import PersonMarker from "./PersonMarker";
import TemboMark from "./TemboMark";

describe("avatarColour", () => {
  it("depends on the id alone, so a person looks the same in every list", () => {
    const ids = ["fixture-wanjiku-mwangi", "fixture-david-kamau", "user_01", "Ω-legacy:42"];
    const first = ids.map(avatarColour);
    const reordered = ids.toReversed().map(avatarColour).toReversed();
    expect(reordered).toEqual(first);
    expect(ids.map(avatarColour)).toEqual(first);
  });

  it("only ever returns a brand palette colour", () => {
    for (let n = 0; n < 500; n += 1) {
      expect(AVATAR_PALETTE).toContain(avatarColour(`user-${n}`));
    }
  });

  it("spreads similar ids across the whole palette", () => {
    const used = new Set(Array.from({ length: 60 }, (_, n) => avatarColour(`user-${n}`)));
    expect(used.size).toBe(AVATAR_PALETTE.length);
  });

  it("is pinned, so colours do not shuffle between releases", () => {
    expect(["", "a", "fixture-wanjiku-mwangi"].map(avatarColour)).toMatchInlineSnapshot(`
      [
        "#F7B08F",
        "#C8E6E0",
        "#C8E6E0",
      ]
    `);
  });
});

describe("initials", () => {
  it.each([
    ["Wanjiku Mwangi", "WM"],
    ["Achieng Atieno Otieno", "AO"],
    ["Tembo", "T"],
    ["  lucy   chebet ", "LC"],
    ["Ōmondi Ébéle", "ŌÉ"],
    ["", "?"],
    ["   ", "?"],
  ])("%j → %s", (name, expected) => {
    expect(initials(name)).toBe(expected);
  });
});

describe("Avatar", () => {
  it("names a person by initials on their colour", () => {
    const html = renderToStaticMarkup(<Avatar id="fixture-david-kamau" name="David Kamau" />);
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="David Kamau"');
    expect(html).toContain('<span aria-hidden="true">DK</span>');
    expect(html).toContain(`background-color:${avatarColour("fixture-david-kamau")}`);
  });

  it("gives a photo the person's name as alt text", () => {
    const html = renderToStaticMarkup(<Avatar id="u1" name="Brian Kiprop" src="/brian.png" />);
    expect(html).toMatch(/<img src="\/brian.png" alt="Brian Kiprop"/);
    expect(html).not.toContain("role=");
  });

  it("stays silent beside a written name", () => {
    const initialsOnly = renderToStaticMarkup(<Avatar id="u1" name="Brian Kiprop" decorative />);
    expect(initialsOnly).toContain('aria-hidden="true"');
    expect(initialsOnly).not.toContain("aria-label");
    expect(initialsOnly).not.toContain('role="img"');
    const photo = renderToStaticMarkup(<Avatar id="u1" name="Brian Kiprop" src="/b.png" decorative />);
    expect(photo).toContain('alt=""');
  });

  it.each([
    ["xs", "size-5"],
    ["sm", "size-6"],
    ["md", "size-8"],
    ["lg", "size-12"],
    ["xl", "size-16"],
  ] as const)("is %s at %s", (size, cls) => {
    expect(renderToStaticMarkup(<Avatar id="u1" name="A B" size={size} />)).toContain(cls);
  });

  it("puts mentors in a teal ring", () => {
    const html = renderToStaticMarkup(<Avatar id="u1" name="Mercy Wambui" mentor />);
    expect(html).toContain('data-mentor="true"');
    expect(html).toContain("outline-ring");
    expect(renderToStaticMarkup(<Avatar id="u1" name="Mercy Wambui" />)).not.toContain("outline-ring");
  });
});

describe("TemboMark", () => {
  it("is the T in Mattone on dark teal inside a peach ring, named Tembo", () => {
    const html = renderToStaticMarkup(<TemboMark />);
    expect(html).toContain('aria-label="Tembo"');
    expect(html).toContain("font-heading");
    expect(html).toContain("bg-dark");
    expect(html).toContain("border-primary");
    expect(html).toContain("text-primary");
    expect(html).toMatch(/>T<\/span>/);
  });

  it("can be decoration beside the word Tembo", () => {
    const html = renderToStaticMarkup(<TemboMark decorative />);
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("aria-label");
  });

  it("has a marker size for use beside a name", () => {
    expect(renderToStaticMarkup(<TemboMark size="marker" />)).toContain("size-4");
  });
});

describe("PersonMarker", () => {
  it.each([
    ["builder", "rounded-full bg-primary"],
    ["mentor", "rounded-full border-2 border-ring"],
    ["institution", "rotate-45 bg-ink-primary"],
  ] as const)("draws a %s in the network language", (kind, cls) => {
    const html = renderToStaticMarkup(<PersonMarker kind={kind} />);
    expect(html).toContain(`data-person-marker="${kind}"`);
    expect(html).toContain(cls);
  });

  it("uses Tembo's own mark for Tembo", () => {
    expect(renderToStaticMarkup(<PersonMarker kind="tembo" />)).toContain("data-tembo-mark");
  });

  it("is decoration unless labelled", () => {
    expect(renderToStaticMarkup(<PersonMarker kind="mentor" />)).toContain('aria-hidden="true"');
    const labelled = renderToStaticMarkup(<PersonMarker kind="mentor" label="Mentor" />);
    expect(labelled).toContain('role="img"');
    expect(labelled).toContain('aria-label="Mentor"');
  });
});
