import { globSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defineConfig } from "vitest/config";

// One Vitest project per workspace package/app with a src/ directory, named after its package.json.
// Only src/ is searched so compiled copies of the tests in dist/ never run.
const packageDirs = globSync("{packages,apps}/*/src").map((src) => dirname(src));

export default defineConfig({
  test: {
    passWithNoTests: false,
    projects: packageDirs.map((root) => ({
      extends: true,
      root,
      test: {
        name: (JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as { name: string }).name,
        include: ["src/**/*.test.ts"],
      },
    })),
  },
});
