import { Palette, PaletteOptions } from "@mui/material/styles";

declare module "@mui/material/styles/createPalette" {
  interface Palette {
    dark?: Palette["primary"];
    orange?: Palette["primary"];
  }
  interface PaletteOptions {
    dark?: PaletteOptions["primary"];
    orange?: PaletteOptions["primary"];
  }
}
