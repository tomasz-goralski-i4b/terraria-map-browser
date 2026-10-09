import { globSync, readFileSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import { distServer, setDistServerOffline } from "./apps/web/tests/support/dist-server.ts";

// One Vitest project per workspace package/app with a src/ directory, named after its package.json.
// Search source and test tooling, never compiled copies in dist/.
const packageDirs = globSync("{packages,apps}/*/src").map((src) => dirname(src));

// Headless Chromium on a machine without a GPU needs a software GL backend (SwiftShader) to offer WebGL2.
const softwareWebGl = ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"];

/**
 * Opt-in (docs/assets.md, "Opt-in integration test"): builds a small sprite atlas from the local Terraria Content
 * folder in TERRARIA_CONTENT, with only the tile sheets of `tileIds`, and returns it with base64 pages. Null when the
 * variable is unset (CI): the test then skips. Nothing is written anywhere.
 */
async function buildLocalAtlas(tileIds: readonly number[]): Promise<{
  pageSize: number; pages: string[]; entries: unknown[]; missing: number;
} | null> {
  const content = process.env["TERRARIA_CONTENT"];
  if (content === undefined || content === "") return null;
  const images = join(content, "Images");
  const wanted = new Set(tileIds.map((id) => `tiles_${String(id)}.xnb`));
  const names = (await readdir(images)).filter((name) => wanted.has(name.toLowerCase()));
  // The built package, loaded only when the test runs (scripts/build.sh builds it first).
  const assets = (await import(pathToFileURL(resolve("packages/assets/dist/index.js")).href)) as typeof import("./packages/assets/src/index.js");
  const directory = {
    getDirectoryHandle: () => Promise.reject(new Error("no sub-directories")),
    entries: async function* () {
      for (const name of names) {
        const path = join(images, name);
        const info = await stat(path);
        const file = {
          name, size: info.size, lastModified: info.mtimeMs,
          arrayBuffer: async () => {
            const bytes = await readFile(path);
            return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
          },
        };
        yield [name, { kind: "file", getFile: () => Promise.resolve(file) }] as [string, { kind: string; getFile: () => Promise<typeof file> }];
      }
    },
  };
  const { atlas, missing } = await assets.buildSpriteAtlas(directory, { pageSize: 2048 });
  return {
    pageSize: atlas.index.pageSize,
    pages: atlas.pages.map((page) => Buffer.from(page).toString("base64")),
    entries: [...atlas.index.entries],
    missing: missing.length,
  };
}

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
    root: "packages/renderer",
    test: {
      name: "@studio/renderer/browser",
      include: ["tests/**/*.browser.test.{ts,tsx}"],
      browser: {
        enabled: true,
        headless: true,
        provider: playwright({ launchOptions: { args: softwareWebGl } }),
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
        provider: playwright({ launchOptions: { args: softwareWebGl } }),
        instances: [{ browser: "chromium" as const }],
        commands: {
          readWorldFixture: (_context: unknown, file: string) => {
            if (!/^[A-Za-z0-9]+\.wld$/.test(file)) throw new Error(`not a fixture world: ${file}`);
            return readFileSync(join("packages/test-fixtures/worlds", file)).toString("base64");
          },
          setAppOffline: (_context: unknown, offline: boolean) => {
            setDistServerOffline(offline);
          },
          buildLocalAtlas: (_context: unknown, tileIds: number[]) => buildLocalAtlas(tileIds),
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
    // CI excludes `perf` (scripts/test.sh, STUDIO_SKIP_PERF=1): shared runners with software GL are too slow and too
    // noisy for wall-clock bounds, heavy GPU comparisons and UI flows. Local runs and agent gates still run them.
    tags: [{ name: "perf", description: "Too slow or timing-sensitive for CI runners; skipped in CI, run locally." }],
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
