import "@mui/material/styles";

declare module "@mui/material/styles" {
  interface Palette {
    dark?: Palette["primary"];
    orange?: Palette["primary"];
  }
  interface PaletteOptions {
    dark?: PaletteOptions["primary"];
    orange?: PaletteOptions["primary"];
  }
}
