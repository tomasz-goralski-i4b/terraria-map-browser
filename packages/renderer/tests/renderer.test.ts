import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vitest";
import { RENDERER_PACKAGE } from "../src/index.js";

test("exposes its public entry point", () => {
  expect(RENDERER_PACKAGE).toBe("@studio/renderer");
});

test("does not import React or any UI framework", () => {
  const dir = join(import.meta.dirname, "..", "src");
  const forbidden = /\bfrom\s+["'](?:react|react-dom)(?:\/[^"']*)?["']|\bimport\s*\(\s*["']react/;
  const offenders = readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((name) => /\.tsx?$/.test(name))
    .filter((name) => forbidden.test(readFileSync(join(dir, name), "utf8")));
  expect(offenders).toEqual([]);
});
