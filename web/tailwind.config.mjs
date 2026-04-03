/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}"],
  theme: {
    extend: {
      colors: {
        primary: "#F28D68",
        dark: "#013D39",
        teal: "#2C6964",
      },
      fontFamily: {
        heading: ["Climate Crisis", "cursive"],
        body: ["Maven Pro", "sans-serif"],
      },
    },
  },
  plugins: [],
};
