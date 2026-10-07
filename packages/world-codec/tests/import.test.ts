import { expect, test } from "vitest";

// A cold import of the built entry can exceed the default 5 s while the whole suite runs in parallel.
test("the built codec entry loads in Node without browser globals", { timeout: 30_000 }, async () => {
  expect("Worker" in globalThis).toBe(false);
  expect("window" in globalThis).toBe(false);
  const codec = await import("@studio/world-codec");
  // A module namespace is always defined; prove the public API is actually invokable from the built entry.
  expect(typeof codec.readWorldHeader).toBe("function");
  expect(typeof codec.isFrameImportant).toBe("function");
  expect(() => codec.readWorldHeader(new Uint8Array(0))).toThrow(codec.WorldFormatError);
});
