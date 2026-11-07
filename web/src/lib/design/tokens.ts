import globalCss from "@/styles/global.css?raw";
import { RAISED } from "@/components/platform/ui/tones";
import { contrast, formatRatio, onSurface, over, parseColour, type Rgb } from "./contrast";

/*
 * The theme's colour tokens, read from global.css itself rather than restated,
 * so the style guide can never print a value the site does not use. The groups
 * and words below are the guide's; the values are the stylesheet's.
 */

const THEME = /@theme\s*\{([\s\S]*?)\n\}/.exec(globalCss)?.[1] ?? "";

/** A `--color-<name>` token's value, exactly as global.css writes it. */
export function colourToken(name: string): string {
  const match = new RegExp(`--color-${name}:\\s*([^;]+);`).exec(THEME);
  if (!match) throw new Error(`--color-${name} is not defined in global.css's @theme`);
  return match[1].trim();
}

/** A `--tracking-<name>` token's value. */
export function trackingToken(name: string): string {
  const match = new RegExp(`--tracking-${name}:\\s*([^;]+);`).exec(THEME);
  if (!match) throw new Error(`--tracking-${name} is not defined in global.css's @theme`);
  return match[1].trim();
}

export type ColourRole = {
  /** The token name after `--color-`, which is also the Tailwind colour: `bg-primary`, `text-ink-muted`. */
  token: string;
  name: string;
  use: string;
};

export type ColourGroup = { id: string; title: string; summary: string; colours: readonly ColourRole[] };

export const SHEET_TOKENS = ["cohort", "community", "mentoring", "discover", "admin", "profile"] as const;

export const COLOUR_GROUPS: readonly ColourGroup[] = [
  {
    id: "brand",
    title: "Brand",
    summary: "Peach and dark teal are TTV. Peach is spent carefully: the one primary action on a screen, a builder's dot, a count that needs you.",
    colours: [
      { token: "primary", name: "Peach", use: "Primary actions, builder dots, counts. Dark teal text on it, never white." },
      { token: "dark", name: "Dark teal", use: "The public site's ground, and the ink on peach." },
      { token: "teal", name: "Green", use: "Borders and soft fills on the public site. Not a surface for text: the quieter inks fall short of 4.5:1 on it." },
    ],
  },
  {
    id: "sheets",
    title: "Ground and sheets",
    summary:
      "Behind everything is the ground. Each space is a sheet laid on it, in a tone of its own: close in lightness so every ink reads on all of them, apart in hue so you can tell where you are.",
    colours: [
      { token: "ground", name: "Ground", use: "Behind the sheets, where inactive tabs stand." },
      { token: "sheet-cohort", name: "Cohort sheet", use: "Greener." },
      { token: "sheet-community", name: "Community sheet", use: "The lightest, and the widest-open space." },
      { token: "sheet-mentoring", name: "Mentoring sheet", use: "Bluer." },
      { token: "sheet-discover", name: "Discover sheet", use: "Deeper." },
      { token: "sheet-admin", name: "Admin sheet", use: "The darkest: staff work here." },
      { token: "sheet-profile", name: "Profile sheet", use: "Warmer: your own page." },
    ],
  },
  {
    id: "inks",
    title: "Inks",
    summary: "Text is warm white at three strengths, plus two coloured inks for meaning. Each clears 4.5:1 on every sheet and on a card laid on it.",
    colours: [
      { token: "ink-primary", name: "Ink", use: "Headings, body text, anything you must read." },
      { token: "ink-secondary", name: "Secondary ink", use: "Supporting text, inactive navigation." },
      { token: "ink-muted", name: "Muted ink", use: "Hints, timestamps, quiet labels. Never on a tint." },
      { token: "peach-ink", name: "Peach ink", use: "Peach as text, and the focus ring. Peach itself is too dark to read on a sheet." },
      { token: "ring", name: "Ring", use: "Mentors: their ring and their role. Never a status colour." },
    ],
  },
  {
    id: "status",
    title: "Status inks",
    summary: "For notices and field errors. Colour is never the only signal: an icon and the words say it too.",
    colours: [
      { token: "danger-ink", name: "Danger", use: "Something failed or needs fixing; destructive actions." },
      { token: "success-ink", name: "Success", use: "Something worked." },
      { token: "warning-ink", name: "Warning", use: "A caution before something that cannot be undone." },
    ],
  },
  {
    id: "lines",
    title: "Lines",
    summary: "Edges are hairlines, so surfaces read as one material. A control's edge is the exception: it has to be found.",
    colours: [
      { token: "hairline", name: "Hairline", use: "Card edges, dividers, quiet buttons." },
      { token: "rule", name: "Rule", use: "Editorial dividers on the public site." },
    ],
  },
];

/** How far a card lifts off its sheet: the kit's RAISED tint, `bg-ink-primary/<n>`. */
const CARD_LIFT = Number(/bg-ink-primary\/(\d+)/.exec(RAISED)?.[1] ?? Number.NaN) / 100;

/** Every surface body text can land on: each sheet, and a card laid on each. */
export function readingSurfaces(): Rgb[] {
  const ink = parseColour(colourToken("ink-primary")).rgb;
  return SHEET_TOKENS.flatMap((space) => {
    const sheet = parseColour(colourToken(`sheet-${space}`)).rgb;
    return [sheet, over(ink, CARD_LIFT, sheet)];
  });
}

/** An ink's lowest contrast across every sheet and card, printed: "4.76:1". */
export function worstContrast(inkToken: string): string {
  return formatRatio(Math.min(...readingSurfaces().map((surface) => contrast(onSurface(colourToken(inkToken), surface), surface))));
}
