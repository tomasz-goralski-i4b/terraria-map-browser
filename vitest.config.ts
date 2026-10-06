import { globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";

// One Vitest project per workspace package/app with a src/ directory, named after its package.json.
// Search source and test tooling, never compiled copies in dist/.
const packageDirs = globSync("{packages,apps}/*/src").map((src) => dirname(src));

export default defineConfig({
  test: {
    passWithNoTests: false,
    projects: [
      ...packageDirs.map((root) => ({
        extends: true,
        root,
        test: {
          name: (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string }).name,
          environment: "node",
          include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
          exclude: ["**/*.browser.test.ts"],
        },
      })),
      {
        extends: true,
        root: "packages/world-codec",
        test: {
          name: "@studio/world-codec/browser",
          include: ["tests/**/*.browser.test.ts"],
          browser: {
            enabled: true,
            headless: true,
            provider: playwright(),
            instances: [{ browser: "chromium" }],
          },
        },
      },
    ],
  },
});
