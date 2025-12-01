import nextConfig from "eslint-config-next";
import eslintConfigPrettier from "eslint-config-prettier";

const ignores = {
  ignores: ["node_modules/**", ".next/**", "coverage/**", "dist/**"],
};

export default [
  ignores,
  ...nextConfig,
  eslintConfigPrettier,
  {
    rules: {
      "react-hooks/preserve-manual-memoization": "off",
      "import/no-anonymous-default-export": "off",
    },
  },
];
