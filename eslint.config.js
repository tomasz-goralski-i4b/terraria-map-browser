import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores(["**/dist/**", "**/node_modules/**", "dotnet/**", "**/*.config.*", "scripts/**", ".ai/**",
    // Gitignored local game assets and scratch tools that are never part of a project.
    "local-assets/**", "local-renders/**",
    // Local agent state; its worktrees are whole checkouts that would be type-checked a second time.
    ".claude/**"]),
  js.configs.recommended,
  tseslint.configs.strictTypeChecked,
  tseslint.configs.stylisticTypeChecked,
  {
    linterOptions: { reportUnusedDisableDirectives: "error", reportUnusedInlineConfigs: "error" },
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
  {
    // React rules apply to the web app only.
    files: ["apps/web/**/*.{ts,tsx}"],
    extends: [reactHooks.configs.flat.recommended],
  },
  {
    // The renderer is framework-free: it is drawn from, never part of, the React tree.
    files: ["packages/renderer/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            { group: ["react", "react/*", "react-dom", "react-dom/*"], message: "@studio/renderer must not import React." },
          ],
        },
      ],
    },
  },
);
