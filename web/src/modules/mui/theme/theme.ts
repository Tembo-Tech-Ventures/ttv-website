import { createTheme } from "@mui/material/styles";
import { climateCrisis, mavenPro } from "./fonts";
import { customColors } from "./constants";

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
      wordWrap: "break-word",
    },
    h2: {
      fontFamily: climateCrisis.style.fontFamily,
      wordWrap: "break-word",
      fontSize: "3rem",
    },
    h3: {
      fontFamily: climateCrisis.style.fontFamily,
      wordWrap: "break-word",
      fontSize: "2.5rem",
    },
    h4: {
      fontFamily: mavenPro.style.fontFamily,
      fontWeight: 700,
      fontSize: "2rem",
    },
    h5: {
      fontFamily: mavenPro.style.fontFamily,
      fontWeight: 700,
      fontSize: "1.5rem",
    },
    h6: {
      fontFamily: mavenPro.style.fontFamily,
      fontWeight: 700,
      fontSize: "1.2rem",
    },
    body1: {
      color: "#fff",
      fontSize: "1.2rem",
    },
    body2: {
      color: "#fff",
      fontSize: "1rem",
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
  },
});
