import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import eslintPluginAstro from "eslint-plugin-astro";
import jsxA11y from "eslint-plugin-jsx-a11y";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const typedFiles = ["**/*.{ts,tsx}"];
const typedConfigs = [
  ...tseslint.configs.strictTypeChecked,
  ...tseslint.configs.stylisticTypeChecked,
].map((config) => ({ ...config, files: typedFiles }));

const hookRules = Object.fromEntries(
  Object.entries(reactHooks.configs.flat["recommended-latest"].rules).map(
    ([rule, severity]) => [rule, severity === "warn" ? "error" : severity]
  )
);

export default [
  {
    ignores: [
      "coverage/",
      "dist/",
      ".astro/",
      "node_modules/",
      "worker-configuration.d.ts",
    ],
  },
  eslint.configs.recommended,
  ...typedConfigs,
  ...eslintPluginAstro.configs.recommended,
  ...eslintPluginAstro.configs["flat/jsx-a11y-strict"],
  {
    files: typedFiles,
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "no-restricted-imports": [
        "error",
        {
          paths: [
            {
              name: "openai",
              message: "Route AI inference through Cloudflare AI Gateway helpers.",
            },
            {
              name: "@anthropic-ai/sdk",
              message: "TTV uses Cloudflare AI Gateway unified mode with Gemma 4.",
            },
          ],
          patterns: ["@anthropic-ai/*"],
        },
      ],
    },
  },
  {
    files: ["**/*.tsx"],
    plugins: {
      "jsx-a11y": jsxA11y,
      "react-hooks": reactHooks,
    },
    rules: {
      ...jsxA11y.flatConfigs.strict.rules,
      ...hookRules,
    },
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    rules: {
      curly: ["error", "all"],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-console": ["error", { allow: ["error", "warn"] }],
      "no-debugger": "error",
      "no-duplicate-imports": "error",
      "prefer-const": "error",
    },
  },
  {
    files: ["scripts/**/*.mjs", "*.config.{js,mjs,ts}"],
    languageOptions: {
      globals: {
        AbortController: "readonly",
        Buffer: "readonly",
        console: "readonly",
        fetch: "readonly",
        process: "readonly",
        Response: "readonly",
        setTimeout: "readonly",
        structuredClone: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
      },
    },
    rules: {
      "no-useless-assignment": "off",
      "preserve-caught-error": "off",
    },
  },
  {
    files: ["**/*.test.{ts,tsx}"],
    rules: {
      // Vitest spies intentionally pass object methods to expect().
      "@typescript-eslint/unbound-method": "off",
    },
  },
  {
    files: ["src/env.d.ts"],
    rules: {
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/triple-slash-reference": "off",
    },
  },
  {
    files: ["**/*.astro"],
    plugins: {
      "@typescript-eslint": tseslint.plugin,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
      "no-useless-assignment": "off",
    },
  },
  eslintConfigPrettier,
];
