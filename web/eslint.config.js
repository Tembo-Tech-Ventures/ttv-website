import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import { configs as astroConfigs } from "eslint-plugin-astro";
import oxlint from "eslint-plugin-oxlint";

export default [
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...astroConfigs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      globals: {
        console: "readonly",
        process: "readonly",
        fetch: "readonly",
        URL: "readonly",
        Response: "readonly",
        // Browser globals, for the bodies of `page.evaluate` callbacks. Those
        // run in the page rather than in Node, and are lexically inside these
        // files with no way for the linter to tell the difference.
        document: "readonly",
        window: "readonly",
        NodeFilter: "readonly",
      },
    },
    rules: {
      "no-useless-assignment": "off",
      "preserve-caught-error": "off",
    },
  },
  {
    files: ["src/env.d.ts"],
    rules: {
      "@typescript-eslint/triple-slash-reference": "off",
    },
  },
  {
    files: ["**/*.astro"],
    rules: {
      "no-useless-assignment": "off",
    },
  },
  {
    ignores: ["dist/", ".astro/", "node_modules/", "worker-configuration.d.ts"],
  },
  ...oxlint.buildFromOxlintConfigFile("./.oxlintrc.json"),
];
