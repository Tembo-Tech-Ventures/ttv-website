/**
 * Design tokens for the TTV brand refresh. See
 * `design-proposal/PROPOSAL.md` §B (Color system) for the rationale behind
 * each addition.
 *
 * We keep the original `dark`, `orange`, and `lessDark` palettes so existing
 * `dark.main` / `secondary.main` references in the codebase continue to
 * resolve, and layer the new tokens (`bgRaised`, `accentBright`, `ink`,
 * `rule`) alongside them.
 */
export const customColors = {
  dark: {
    main: "#013D39",
  },
  orange: {
    main: "#F28D68",
  },
  lessDark: {
    main: "#2C6964",
  },
  /**
   * Slightly darker than `dark.main`. Used for cards that need to recede
   * instead of advancing (the default secondary/`lessDark` surface is a
   * lighter teal, which reads as "raised toward the viewer").
   */
  bgRaised: {
    main: "#063F3A",
  },
  /**
   * Warm highlight reserved for rare moments — stat callouts, "new" badges,
   * single-line emphasis inside editorial copy. Never use in bulk; its job
   * is to surprise.
   */
  accentBright: {
    main: "#FFD166",
  },
  /**
   * Warm off-white body-text ink. A 5% tint toward orange stops the dark
   * theme from reading as clinical / default-MUI.
   */
  ink: {
    primary: "#FFF8F2",
    secondary: "rgba(255, 248, 242, 0.72)",
    muted: "rgba(255, 248, 242, 0.48)",
  },
  /**
   * Hairline rule color — a 20% orange derived from `accent.primary`. Use
   * for dividers, section caps, and bento borders.
   */
  rule: "rgba(242, 141, 104, 0.20)",
};

export const getShadow = (size: "sm" | "md" | "lg") => {
  if (size === "sm") return `0 5px 10px -5px rgba(0,0,0,0.4)`;
  if (size === "md") return `0 10px 20px -10px rgba(0,0,0,0.4)`;
  return `0 15px 35px -10px rgba(0,0,0,0.4)`;
};
