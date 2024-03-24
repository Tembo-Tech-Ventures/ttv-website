import createTheme from "@mui/material/styles/createTheme";
import { climateCrisis, mavenPro } from "./fonts";
import { customColors } from "./colors";

export const theme = createTheme({
  palette: {
    mode: "dark",
    primary: customColors.orange,
    secondary: customColors.lessDark,
    ...customColors,
  },
  shape: {
    borderRadius: 16,
  },
  typography: {
    fontFamily: mavenPro.style.fontFamily,
    h1: {
      fontFamily: climateCrisis.style.fontFamily,
    },
    h2: {
      fontFamily: climateCrisis.style.fontFamily,
    },
    h3: {
      fontFamily: climateCrisis.style.fontFamily,
    },
    h4: {
      fontFamily: mavenPro.style.fontFamily,
      fontWeight: 700,
    },
    h5: {
      fontFamily: mavenPro.style.fontFamily,
      fontWeight: 700,
    },
    h6: {
      fontFamily: mavenPro.style.fontFamily,
      fontWeight: 700,
    },
    body1: {
      color: "#fff",
      fontSize: "1.4rem",
    },
    body2: {
      color: "#fff",
      fontSize: "1rem",
    },
  },
});
