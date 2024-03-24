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
};

export const getShadow = (size: "sm" | "md" | "lg") => {
  if (size === "sm") return `0 5px 10px -5px rgba(0,0,0,0.4)`;
  if (size === "md") return `0 10px 20px -10px rgba(0,0,0,0.4)`;
  return `0 15px 35px -10px rgba(0,0,0,0.4)`;
};
