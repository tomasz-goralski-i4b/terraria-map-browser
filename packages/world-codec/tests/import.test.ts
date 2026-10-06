import { expect, test } from "vitest";

test("the built codec entry loads in Node without browser globals", async () => {
  expect("Worker" in globalThis).toBe(false);
  expect("window" in globalThis).toBe(false);
  const codec = await import("@studio/world-codec");
  expect(codec).toBeDefined();
});
