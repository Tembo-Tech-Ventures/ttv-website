/*
 * What the kit-compliance ratchet counts (kit-compliance.test.ts), and where.
 * The counts each file may still hold are frozen in kit-compliance.frozen.ts.
 */

const PALETTE = "red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone";
const COLOUR_UTILITY = "text|bg|border|ring|fill|stroke|outline|divide|decoration|from|to|via|placeholder|shadow|accent|caret";

/** The public site, which the platform-only rules leave alone (the rollout's scope is the signed-in pages). */
const PUBLIC = /^(?:pages\/(?:index|404|community|demo|openai-hackathon)\.astro$|pages\/(?:auth|blog|certificate|community|hire|talent|style-guide)\/|components\/(?:auth|certificate|hackathon|hire|homepage|style-guide|talent)\/)/;

export interface KitRule {
  /** What to use instead: the message a file that gains a match sees. */
  instead: string;
  pattern: RegExp;
  /** Which files it applies to, by path under src/; every scanned file when absent. */
  applies?: (path: string) => boolean;
}

export const KIT_RULES: Record<string, KitRule> = {
  "raw white or black": {
    instead: "an ink or ground token (text-ink-primary, text-dark, bg-ground…)",
    pattern: new RegExp(`\\b(?:${COLOUR_UTILITY})-(?:white|black)\\b`, "g"),
  },
  "Tailwind palette colours": {
    instead: "a tone token (danger-ink, success-ink, warning-ink…) or a kit part (Notice, StatusChip)",
    pattern: new RegExp(`\\b(?:${COLOUR_UTILITY})-(?:${PALETTE})-\\d{2,3}\\b`, "g"),
  },
  "arbitrary colour values": {
    instead: "a colour token from global.css's @theme",
    pattern: /\b[a-z-]+-\[(?:#|rgba?\(|hsla?\()/g,
  },
  "inline rgb() and hsl()": {
    instead: "var(--color-*) in CSS, or a token utility in markup",
    pattern: /\b(?:rgba?|hsla?)\(/g,
  },
  "the form-control utility": {
    instead: "the kit's fields (TextField, TextAreaField, SelectField…)",
    pattern: /\bform-control\b/g,
  },
  "the spaces/PageTitle.astro shim": {
    instead: "PageTitle or PageHeader from @/components/platform/ui",
    pattern: /spaces\/PageTitle(?:\.astro)?["']/g,
  },
  "status flags in the query string": {
    instead: "redirectWithFlash and takeFlash (@/lib/platform/server/flash)",
    pattern: /[?&](?:done|saved|sent|notice|success|decided)=|searchParams\.get\(["'](?:done|saved|sent|notice|success|decided)["']\)/g,
  },
  "eyebrows (uppercase tracked labels)": {
    instead: "a sentence-case Maven heading or label: the guide has no eyebrows",
    pattern: /\buppercase\b[^"'`]*\btracking-|\btracking-[^"'`]*\buppercase\b/g,
    applies: (path) => !PUBLIC.test(path),
  },
  "the older surface tokens": {
    instead: "the sheet tones and RAISED, with hairline borders (border-hairline)",
    pattern: /\b(?:bg-bg-raised|bg-surface|border-rule)\b/g,
    applies: (path) => !PUBLIC.test(path),
  },
};
