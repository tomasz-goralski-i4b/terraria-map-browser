import { globSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import { distServer, setDistServerOffline } from "./apps/web/tests/support/dist-server.ts";

// One Vitest project per workspace package/app with a src/ directory, named after its package.json.
// Search source and test tooling, never compiled copies in dist/.
const packageDirs = globSync("{packages,apps}/*/src").map((src) => dirname(src));

// Browser projects are registered by hand: each may need its own plugins or commands.
const browserProjects = [
  {
    extends: true as const,
    root: "packages/world-codec",
    test: {
      name: "@studio/world-codec/browser",
      include: ["tests/**/*.browser.test.{ts,tsx}"],
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
        instances: [{ browser: "chromium" as const }],
      },
    },
  },
  {
    extends: true as const,
    root: "packages/assets",
    test: {
      name: "@studio/assets/browser",
      include: ["tests/**/*.browser.test.{ts,tsx}"],
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
        instances: [{ browser: "chromium" as const }],
      },
    },
  },
  {
    extends: true as const,
    root: "apps/web",
    // Serves the production build (built by scripts/build.sh) for the offline PWA test.
    plugins: [react(), distServer(resolve("apps/web/dist"))],
    test: {
      name: "@studio/web/browser",
      include: ["tests/**/*.browser.test.{ts,tsx}"],
      browser: {
        enabled: true,
        headless: true,
        provider: playwright(),
        instances: [{ browser: "chromium" as const }],
        commands: {
          readWorldFixture: (_context: unknown, file: string) => {
            if (!/^[A-Za-z0-9]+\.wld$/.test(file)) throw new Error(`not a fixture world: ${file}`);
            return readFileSync(join("packages/test-fixtures/worlds", file)).toString("base64");
          },
          setAppOffline: (_context: unknown, offline: boolean) => {
            setDistServerOffline(offline);
          },
        },
      },
    },
  },
];

// The Node projects exclude *.browser.test.*, so browser tests of a package without a browser project above would be
// silently skipped. Fail loading the config instead.
const unregistered = [
  ...new Set(
    globSync("{packages,apps}/*/tests/**/*.browser.test.{ts,tsx}").map((file) =>
      file.replaceAll("\\", "/").split("/").slice(0, 2).join("/"),
    ),
  ),
].filter((root) => !browserProjects.some((project) => project.root === root));
if (unregistered.length > 0) {
  throw new Error(
    `Browser tests without a browser project in vitest.config.ts: ${unregistered.join(", ")}. ` +
      "Register one (docs/tooling.md, browser tests).",
  );
}

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
          exclude: ["**/*.browser.test.ts", "**/*.browser.test.tsx"],
          // The atlas tests compare multi-megabyte RGBA pages with toEqual, which takes seconds per page.
          ...(root.replaceAll("\\", "/") === "packages/assets" ? { testTimeout: 60_000 } : {}),
        },
      })),
      ...browserProjects,
    ],
  },
});
