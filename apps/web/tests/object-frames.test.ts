import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { readWorldTiles } from "@studio/world-codec";
import { resolveObject, type Tile } from "@studio/world-model";
import { tileProperties } from "../src/panels/InspectorPanel.js";
import { canonicalWorldOf } from "../src/world/canonical-world.js";

const at = { x: 3, y: 4 };
const tile = (id: number, frameX: number, frameY: number): Tile => ({ block: { kind: "vanilla", id }, frameX, frameY, wires: 0, actuator: false });
const row = (rows: ReturnType<typeof tileProperties>, label: string): unknown => rows.find((property) => property.label === label)?.value;

test("a pinned chest tile shows its style and part by default and its raw frame only with every field", () => {
  const shy = tileProperties(at, tile(21, 450, 0), false);
  expect(row(shy, "Style")).toBe("12");
  expect(row(shy, "Part")).toBe("right, top");
  expect(row(shy, "Frame X")).toBeUndefined();
  expect(row(shy, "Frame Y")).toBeUndefined();
  const all = tileProperties(at, tile(21, 450, 0), true);
  expect(all.map((property) => property.label).slice(3, 7)).toEqual(["Style", "Part", "Frame X", "Frame Y"]);
  expect(row(all, "Frame X")).toBe("450");
});

test.each([
  [88, 108, 18, "2", "left, bottom"],
  [34, 18, 72, "1", "middle, middle"],
  [10, 0, 36, "0", "bottom"],
  [15, 0, 58, "1", "bottom"],
])("tile %i at frame (%i, %i) shows style %s, part %s", (id, frameX, frameY, style, part) => {
  const rows = tileProperties(at, tile(id, frameX, frameY), false);
  expect([row(rows, "Style"), row(rows, "Part")]).toEqual([style, part]);
});

test("a one-tile object has a style but no part; a block that is no object has neither", () => {
  const torch = tileProperties(at, tile(4, 0, 66), false);
  expect([row(torch, "Style"), row(torch, "Part")]).toEqual(["3", undefined]);
  const stone = tileProperties(at, tile(1, 18, 0), true);
  expect([row(stone, "Style"), row(stone, "Part")]).toEqual(["None", "None"]);
});

test.each(["SCCO1", "SCCR2", "SECR1", "SJCO1", "SMCO1"])("every chest record of %s has its origin tile at part (0, 0)", (name) => {
  const loaded = readWorldTiles(readFileSync(new URL(`../../../packages/test-fixtures/worlds/${name}.wld`, import.meta.url)));
  const world = canonicalWorldOf(loaded);
  const chests = loaded.entities.Chests.data?.entries ?? [];
  expect(chests.length).toBeGreaterThan(0);
  for (const chest of chests) {
    const origin = world.tileAt(chest.x, chest.y);
    if (origin.block?.kind !== "vanilla") throw new Error(`chest at ${String(chest.x)}, ${String(chest.y)} has no vanilla block`);
    expect(resolveObject(origin.block.id, origin.frameX ?? -1, origin.frameY ?? -1)?.part, `chest at ${String(chest.x)}, ${String(chest.y)}`).toEqual({ dx: 0, dy: 0 });
  }
});
