import createTheme from "@mui/material/styles/createTheme";
import { climateCrisis, mavenPro } from "./fonts";
import { customColors } from "./constants";

/**
 * Theme definition for the TTV design refresh.
 *
 * See `design-proposal/PROPOSAL.md` §A (Typography system) for the role
 * split. Headline (h1/h2) remain Climate Crisis but are reserved for
 * ≥48px usage; h3/h4/h5/h6 move to Maven Pro so that the chunky display
 * face is never forced into a small size where it becomes hard to read.
 */
export const theme = createTheme({
  palette: {
    mode: "dark",
    primary: customColors.orange,
    secondary: customColors.lessDark,
    background: {
      default: customColors.dark.main,
      paper: customColors.bgRaised.main,
    },
    text: {
      primary: customColors.ink.primary,
      secondary: customColors.ink.secondary,
      disabled: customColors.ink.muted,
    },
    divider: customColors.rule,
    ...customColors,
  },
  shape: {
    borderRadius: 16,
  },
  typography: {
    fontFamily: mavenPro.style.fontFamily,
    // h1/h2 are reserved for the display/hero role — Climate Crisis at
    // display sizes only. Components that need small headings should
    // reach for h4/h5/h6 (Maven Pro Bold) instead.
    h1: {
      fontFamily: climateCrisis.style.fontFamily,
      wordWrap: "break-word",
      fontWeight: 400,
      letterSpacing: "-0.02em",
    },
    h2: {
      fontFamily: climateCrisis.style.fontFamily,
      wordWrap: "break-word",
      fontSize: "clamp(2.5rem, 5vw, 4rem)",
      fontWeight: 400,
      letterSpacing: "-0.01em",
    },
    h3: {
      fontFamily: mavenPro.style.fontFamily,
      fontWeight: 700,
      fontSize: "2rem",
      letterSpacing: "-0.01em",
    },
    h4: {
      fontFamily: mavenPro.style.fontFamily,
      fontWeight: 700,
      fontSize: "1.5rem",
    },
    h5: {
      fontFamily: mavenPro.style.fontFamily,
      fontWeight: 700,
      fontSize: "1.25rem",
    },
    h6: {
      fontFamily: mavenPro.style.fontFamily,
      fontWeight: 700,
      fontSize: "1.05rem",
      textTransform: "uppercase",
      letterSpacing: "0.08em",
    },
    body1: {
      color: customColors.ink.primary,
      fontSize: "1.125rem",
      lineHeight: 1.6,
    },
    body2: {
      color: customColors.ink.secondary,
      fontSize: "1rem",
      lineHeight: 1.6,
    },
    overline: {
      fontFamily: mavenPro.style.fontFamily,
      fontWeight: 500,
      letterSpacing: "0.14em",
      textTransform: "uppercase",
      fontSize: "0.75rem",
    },
  },
  components: {
    MuiToolbar: {
      styleOverrides: {
        root: {
          backgroundColor: customColors.dark.main,
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        paper: {
          backgroundColor: customColors.dark.main,
        },
      },
    },
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          color: customColors.ink.primary,
        },
      },
    },
  },
});
