import { expect, test } from "vitest";
import { readWorldTiles, writeWorld } from "@studio/world-codec";
import { verifyWrittenWorld } from "../src/world/verify-written.js";
import { writerSource } from "./support/export-source.js";

test("a written world that decodes to the same world passes", () => {
  const world = readWorldTiles(writerSource(2, 4, undefined, 279));
  expect(verifyWrittenWorld(world, writeWorld(world))).toBeNull();
});

test("a tile that differs after writing is reported by plane and index", () => {
  const world = readWorldTiles(writerSource());
  const output = writeWorld(world);
  world.planes.paint[3] = 7;
  expect(verifyWrittenWorld(world, output)).toBe("tile 3 differs in paint");
});

/** Two columns of four stone blocks (active, 1-byte type 1, run of 3 more). */
const STONE = [0x42, 1, 3, 0x42, 1, 3];

test("blocks are compared by the content they name, not by palette index", () => {
  const world = readWorldTiles(writerSource(2, 4, STONE));
  const output = writeWorld(world);
  const block = world.planes.block[0] ?? 0;
  const original = world.palette[block];
  if (original === undefined) throw new Error("the fixture's first tile has a block");
  // Same content under another palette index: equal.
  Object.assign(world, { palette: [{ kind: "vanilla", id: 4242 }, ...world.palette] });
  world.planes.block.forEach((value, index) => {
    if (value !== 0xffff) world.planes.block[index] = value + 1;
  });
  expect(verifyWrittenWorld(world, output)).toBeNull();
  // Another content at the same index: different.
  Object.assign(world, { palette: world.palette.map((ref) => (ref === original ? { kind: "vanilla", id: 4243 } : ref)) });
  expect(verifyWrittenWorld(world, output)).toBe("tile 0 differs in block");
});

test("metadata, details and kept sections are compared too, not only tiles", () => {
  const world = readWorldTiles(writerSource());
  const output = writeWorld(world);
  Object.assign(world, { metadata: { ...world.metadata, seed: "changed" } });
  expect(verifyWrittenWorld(world, output)).toBe("world.metadata.seed differs");
});

test("bytes that cannot be read back are reported, not thrown", () => {
  const world = readWorldTiles(writerSource());
  expect(verifyWrittenWorld(world, new ArrayBuffer(10))).toMatch(/^the written file cannot be read back/);
});
