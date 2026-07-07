import path from "node:path";
import { fileURLToPath } from "node:url";

import js from "@eslint/js";
import { FlatCompat } from "@eslint/eslintrc";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import reactHooksPlugin from "eslint-plugin-react-hooks";
import noHardcodedStrings from "eslint-plugin-no-hardcoded-strings";
import globals from "globals";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

const sharedTsLanguageOptions = {
  parser: tsParser,
  ecmaVersion: "latest",
  sourceType: "module",
};

export default [
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "apps/app/**",
      "apps/web/playwright-report/**",
      "apps/web/test-results/**",
    ],
  },
  ...compat
    .extends(
      "eslint:recommended",
      "plugin:@typescript-eslint/recommended",
      "plugin:react-hooks/recommended",
      "prettier",
    )
    .map((config) => ({
      ...config,
      files: ["apps/web/**/*.{ts,tsx,js,jsx}"],
    })),
  {
    files: ["apps/web/**/*.{ts,tsx,js,jsx}"],
    languageOptions: {
      ...sharedTsLanguageOptions,
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.jest,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      "react-hooks": reactHooksPlugin,
      "no-hardcoded-strings": noHardcodedStrings,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "react-hooks/exhaustive-deps": "error",
      "react-hooks/set-state-in-effect": "error",
      "react-hooks/incompatible-library": "error",
      "react-hooks/purity": "error",
      "react-hooks/static-components": "error",
      "react-hooks/preserve-manual-memoization": "error",
      "no-hardcoded-strings/no-hardcoded-strings": "off",
    },
  },
  ...compat
    .extends(
      "eslint:recommended",
      "plugin:@typescript-eslint/recommended",
      "prettier",
    )
    .map((config) => ({
      ...config,
      files: ["apps/api/**/*.{ts,tsx,js,jsx}"],
    })),
  {
    files: ["apps/api/**/*.{ts,tsx,js,jsx}"],
    languageOptions: {
      ...sharedTsLanguageOptions,
      globals: {
        ...globals.node,
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  {
    files: [
      "apps/api/**/*.test.ts",
      "apps/api/test/**/*.ts",
      "apps/api/src/**/__tests__/**/*.ts",
    ],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
];
