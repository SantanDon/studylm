import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist", ".ai-bridge", ".playwright-cli", ".playwright-mcp"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],
      "@typescript-eslint/no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrors: "none",
        destructuredArrayIgnorePattern: "^_",
      }],
    },
  },
  {
    files: ["backend/**/*.js", "api/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.es2021,
        fetch: "readonly",
        FormData: "readonly",
        Blob: "readonly",
        URL: "readonly",
        AbortController: "readonly",
      },
    },
    rules: {
      ...js.configs.recommended.rules,
      // Begin with visibility across the legacy backend without turning the
      // whole migration into one risky cleanup commit. These become errors as
      // each route/service is extracted into its own typed module.
      "no-undef": "warn",
      "no-unused-vars": ["warn", {
        argsIgnorePattern: "^_",
        varsIgnorePattern: "^_",
        caughtErrors: "none",
      }],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "no-control-regex": "warn",
      "no-useless-escape": "warn",
      "no-constant-binary-expression": "warn",
    },
  },
);
