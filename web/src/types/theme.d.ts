import { Palette, PaletteOptions } from "@mui/material/styles";

declare module "@mui/material/styles/createPalette" {
  interface Palette {
    dark?: Palette["primary"];
    orange?: Palette["primary"];
    bgRaised?: Palette["primary"];
    accentBright?: Palette["primary"];
    ink?: {
      primary: string;
      secondary: string;
      muted: string;
    };
    rule?: string;
  }
  interface PaletteOptions {
    dark?: PaletteOptions["primary"];
    orange?: PaletteOptions["primary"];
    bgRaised?: PaletteOptions["primary"];
    accentBright?: PaletteOptions["primary"];
    ink?: {
      primary: string;
      secondary: string;
      muted: string;
    };
    rule?: string;
  }
}
