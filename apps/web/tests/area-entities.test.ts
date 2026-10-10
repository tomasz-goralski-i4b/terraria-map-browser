import { readFileSync } from "node:fs";
import { afterEach, expect, test } from "vitest";
import { readWorldHeader, readTileEntityPayloads, readWorldTiles, writeWorld } from "@studio/world-codec";
import { copyArea, planAreaPaste } from "../src/world/area-clipboard.js";
import { commitAreaEdit, setBrushWorld, undoBrush, redoBrush } from "../src/world/brush-session.js";
import { canonicalWorldOf } from "../src/world/canonical-world.js";
import { useAppStore } from "../src/store.js";
import { verifyWrittenWorld } from "../src/world/verify-written.js";
import { brushSource } from "./support/brush-source.js";

function displayDollWorld() {
  const vectors = JSON.parse(readFileSync(new URL("../../../contracts/vectors/entities.vectors.json", import.meta.url), "utf8")) as { vectors: { id: string; hex: string }[] };
  const vector = vectors.vectors.find((item) => item.id === "E07");
  if (vector === undefined) throw new Error("Missing display-doll contract vector");
  const payload = Uint8Array.from(Buffer.from(vector.hex, "hex"));
  const source = brushSource(640, 360, Array.from({ length: 640 }, () => [0x80, 103, 1]).flat());
  source[72 + (470 >> 3)] = (source[72 + (470 >> 3)] ?? 0) | (1 << (470 & 7));
  const { sections } = readWorldHeader(source), delta = payload.length - (sections.tileEntities.end - sections.tileEntities.start);
  const bytes = new Uint8Array(source.length + delta);
  bytes.set(source.subarray(0, sections.tileEntities.start)); bytes.set(payload, sections.tileEntities.start); bytes.set(source.subarray(sections.tileEntities.end), sections.tileEntities.end + delta);
  const data = new DataView(bytes.buffer);
  sections.pointers.forEach((pointer, index) => { data.setInt32(26 + index * 4, pointer + (index >= 6 ? delta : 0), true); });
  const world = readWorldTiles(bytes), view = canonicalWorldOf(world);
  for (let x = 320; x < 322; x++) for (let y = 180; y < 183; y++) view.setTile(x, y, { block: { kind: "vanilla", id: 470 }, frameX: (x - 320) * 18, frameY: (y - 180) * 18, wires: 0, actuator: false });
  return world;
}
afterEach(() => { setBrushWorld(null); });

test("whole display dolls copy lossless state, get unique IDs and retain payloads through repeated copying, undo/redo and save", () => {
  const world = displayDollWorld(); setBrushWorld(world); useAppStore.setState({ phase: "loaded", unsavedChanges: false });
  const clipboard = copyArea(world, { x: 320, y: 180, width: 2, height: 3 });
  const paste = planAreaPaste(world, clipboard, 400, 200);
  expect(commitAreaEdit(world, paste.tiles, paste.apply)).toBe(true);
  expect(world.entities.TileEntities.data?.entries.map((entry) => entry.entityId)).toEqual([45, 46]);
  expect(verifyWrittenWorld(world, writeWorld(world))).toBeNull();
  const repeated = planAreaPaste(world, copyArea(world, { x: 400, y: 200, width: 2, height: 3 }), 500, 200);
  expect(commitAreaEdit(world, repeated.tiles, repeated.apply)).toBe(true);
  expect(world.entities.TileEntities.data?.entries.map((entry) => entry.entityId)).toEqual([45, 46, 47]);
  const written = readWorldTiles(new Uint8Array(writeWorld(world)));
  const payloads = readTileEntityPayloads(written.envelope.source, written.sections.tileEntities);
  expect(payloads[1]?.payload).toEqual(payloads[0]?.payload); expect(payloads[2]?.payload).toEqual(payloads[0]?.payload);
  undoBrush(); undoBrush(); expect(world.entities.TileEntities.data?.entries).toHaveLength(1); expect(world.envelope.tileEntityPayloads).toBeUndefined();
  redoBrush(); redoBrush(); expect(verifyWrittenWorld(world, writeWorld(world))).toBeNull();
});

test("partial and clipped tile entities omit their entire body and all payload data", () => {
  const world = displayDollWorld();
  for (const [width, x] of [[1, 400], [2, 639]] as const) {
    const paste = planAreaPaste(world, copyArea(world, { x: 320, y: 180, width, height: 3 }), x, 200);
    paste.apply("after"); expect(world.entities.TileEntities.data?.entries).toHaveLength(1);
    expect(canonicalWorldOf(world).tileAt(x, 200).block).toBeUndefined();
    expect(world.envelope.tileEntityPayloads).toBeUndefined();
  }
});
