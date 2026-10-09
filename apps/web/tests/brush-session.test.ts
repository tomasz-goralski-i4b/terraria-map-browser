import { expect, test } from "vitest";
import type { WorldPlanes } from "@studio/world-model";
import { readWorldTiles, writeWorld, SUPPORTED_VANILLA_FORMATS } from "@studio/world-codec";
import { createWorldBrush } from "../src/world/brush-session.js";
import { canonicalWorldOf } from "../src/world/canonical-world.js";
import { verifyWrittenWorld } from "../src/world/verify-written.js";
import { brushSource } from "./support/brush-source.js";

test.each(SUPPORTED_VANILLA_FORMATS)("brush edits export current state and reload without other changes (format %i)", (version) => {
  const world = readWorldTiles(brushSource(2, 4, undefined, version));
  const original = (Object.keys(world.planes) as (keyof WorldPlanes)[]).map((name) => world.planes[name].slice());
  const history = createWorldBrush(world);
  expect(history).not.toBeNull();
  history?.begin({ layer: "wall", id: 1, size: 1 });
  history?.move(1, 2);
  history?.commit();
  expect(canonicalWorldOf(world).tileAt(1, 2).wall).toEqual({ kind: "vanilla", id: 1 });
  const output = writeWorld(world);
  expect(verifyWrittenWorld(world, output)).toBeNull();
  const reloaded = readWorldTiles(new Uint8Array(output));
  expect(canonicalWorldOf(reloaded).tileAt(1, 2).wall).toEqual({ kind: "vanilla", id: 1 });
  history?.undo();
  expect(Object.values(world.planes)).toEqual(original);
});

test("protects chest footprints including air and refuses unknown content or undecoded entity sections", () => {
  const world = readWorldTiles(brushSource(6, 6, Array.from({ length: 6 }, () => [0x40, 5]).flat()));
  Object.assign(world.entities.Chests, { data: { entries: [{ x: 1, y: 1, name: "Underground supplies", slotCount: 40, items: [] }] } });
  const history = createWorldBrush(world);
  history?.begin({ layer: "block", id: 1, size: 3 });
  history?.move(3, 3);
  expect(history?.commit()).toHaveLength(5);
  for (const x of [1, 2]) for (const y of [1, 2]) expect(canonicalWorldOf(world).tileAt(x, y).block).toBeUndefined();
  Object.assign(world.entities.Signs, { data: null });
  expect(createWorldBrush(world)).toBeNull();
  const modded = readWorldTiles(brushSource());
  Object.assign(modded, { palette: [{ kind: "unknown", runtimeId: 900 }] });
  expect(createWorldBrush(modded)).toBeNull();
});

test("protects object supports, side attachments and an entity halo even when the anchor is not top-left", () => {
  const world = readWorldTiles(brushSource(6, 6, Array.from({ length: 6 }, () => [0x40, 5]).flat()));
  const view = canonicalWorldOf(world);
  view.setTile(1, 1, { block: { kind: "vanilla", id: 4 }, frameX: 0, frameY: 0, wires: 0, actuator: false });
  view.setTile(1, 2, { block: { kind: "vanilla", id: 1 }, wires: 0, actuator: false });
  const history = createWorldBrush(world);
  history?.begin({ layer: "block", id: null, size: 1 });
  history?.move(1, 2);
  expect(history?.commit()).toEqual([]);
  Object.assign(world.entities.TileEntities, { data: { entries: [{ kind: 3, entityId: 17, x: 4, y: 4, items: [], dyes: [], misc: [], anchorItemId: null }] } });
  const withEntity = createWorldBrush(world);
  withEntity?.begin({ layer: "wall", id: 1, size: 1 });
  withEntity?.move(3, 3);
  expect(withEntity?.commit()).toEqual([]);
});

test.each([[0, 0], [19, 0], [0, 19], [19, 19]])("clips entity protection at world edge (%i,%i) without column aliasing", (x, y) => {
  const world = readWorldTiles(brushSource(20, 20, Array.from({ length: 20 }, () => [0x40, 19]).flat()));
  Object.assign(world.entities.TileEntities, { data: { entries: [{ kind: 3, entityId: 17, x, y, items: [], dyes: [], misc: [], anchorItemId: null }] } });
  const history = createWorldBrush(world);
  history?.begin({ layer: "wall", id: 1, size: 1 });
  history?.move(x, y);
  expect(history?.commit()).toEqual([]);
  history?.begin({ layer: "wall", id: 1, size: 1 });
  history?.move(10, 10);
  expect(history?.commit()).toHaveLength(1);
  if (y === 19) {
    history?.begin({ layer: "wall", id: 1, size: 1 });
    history?.move(x === 0 ? 1 : 18, 0);
    expect(history?.commit()).toHaveLength(1);
  }
});

test("signs and weighted pressure plates protect their attachments even when their block fragments are missing", () => {
  const world = readWorldTiles(brushSource(10, 10, Array.from({ length: 10 }, () => [0x40, 9]).flat()));
  Object.assign(world.entities.Signs, { data: { entries: [{ x: 1, y: 1, text: "Cavern entrance" }] } });
  Object.assign(world.entities.WeightedPressurePlates, { data: { entries: [{ x: 7, y: 7 }] } });
  const history = createWorldBrush(world);
  history?.begin({ layer: "wall", id: 1, size: 1 });
  history?.move(1, 3);
  history?.move(7, 8);
  const changed = history?.commit();
  expect(changed?.some((tile) => tile.x === 1 && tile.y === 3)).toBe(false);
  expect(changed?.some((tile) => tile.x === 7 && tile.y === 8)).toBe(false);
  expect(canonicalWorldOf(world).tileAt(1, 3).wall).toBeUndefined();
  expect(canonicalWorldOf(world).tileAt(7, 8).wall).toBeUndefined();
  expect(changed?.length).toBeGreaterThan(0);
});
