import { expect, test } from "vitest";
import { readWorldTiles, writeWorld, SUPPORTED_VANILLA_FORMATS } from "@studio/world-codec";
import { createWorldBrush } from "../src/world/brush-session.js";
import { canonicalWorldOf } from "../src/world/canonical-world.js";
import { verifyWrittenWorld } from "../src/world/verify-written.js";
import { writerSource } from "./support/export-source.js";

test.each(SUPPORTED_VANILLA_FORMATS)("brush edits export current state and reload without other changes (format %i)", (version) => {
  const world = readWorldTiles(writerSource(2, 4, undefined, version));
  const original = Object.values(world.planes).map((plane) => plane.slice());
  const history = createWorldBrush(world);
  expect(history).not.toBeNull();
  history?.begin({ layer: "wall", id: 1, size: 1 });
  history?.move(1, 2);
  history?.commit();
  expect(canonicalWorldOf(world).tileAt(1, 2).wall).toEqual({ kind: "vanilla", id: 1 });
  const output = writeWorld(world);
  expect(verifyWrittenWorld(world, output)).toBeNull();
  const reloaded = readWorldTiles(output);
  expect(canonicalWorldOf(reloaded).tileAt(1, 2).wall).toEqual({ kind: "vanilla", id: 1 });
  history?.undo();
  expect(Object.values(world.planes)).toEqual(original);
});

test("protects chest footprints including air and refuses unknown content or undecoded entity sections", () => {
  const world = readWorldTiles(writerSource(4, 4, [0x40, 3, 0x40, 3, 0x40, 3, 0x40, 3]));
  Object.assign(world.entities.Chests, { data: { entries: [{ x: 1, y: 1, name: "Underground supplies", slotCount: 40, items: [] }] } });
  const history = createWorldBrush(world);
  history?.begin({ layer: "block", id: 1, size: 3 });
  history?.move(2, 2);
  expect(history?.commit()).toHaveLength(5);
  for (const x of [1, 2]) for (const y of [1, 2]) expect(canonicalWorldOf(world).tileAt(x, y).block).toBeUndefined();
  Object.assign(world.entities.Signs, { data: null });
  expect(createWorldBrush(world)).toBeNull();
  const modded = readWorldTiles(writerSource());
  Object.assign(modded, { palette: [{ kind: "unknown", runtimeId: 900 }] });
  expect(createWorldBrush(modded)).toBeNull();
});
