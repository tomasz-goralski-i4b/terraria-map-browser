import { beforeEach, expect, test } from "vitest";
import {
  addSwatches, createPalette, deletePalette, exportPalettes, hydratePalettes, importPalettes, PALETTES_STORAGE_KEY,
  pushRecentSwatch, removeSwatch, renamePalette, usePaletteStore, type PaletteStorage,
} from "../src/world/brush-palettes.js";

const memory = (initial: Record<string, string> = {}): PaletteStorage & { readonly items: Record<string, string> } => {
  const items = { ...initial };
  return { items, getItem: (key) => items[key] ?? null, setItem: (key, value) => { items[key] = value; } };
};
const stone = { layer: "block", id: 1, paint: 0 } as const;
const redStone = { layer: "block", id: 1, paint: 1 } as const;
const woodWall = { layer: "wall", id: 4, paint: 0 } as const;

beforeEach(() => { hydratePalettes(memory()); });

test("custom palettes keep each swatch once, in order, and survive a reload", () => {
  const storage = memory();
  hydratePalettes(storage);
  const id = createPalette("  Castle  ", [stone]);
  addSwatches(id, [redStone, stone, woodWall, woodWall]);
  expect(usePaletteStore.getState().palettes).toEqual([{ id, name: "Castle", swatches: [stone, redStone, woodWall] }]);
  removeSwatch(id, redStone);
  renamePalette(id, "Keep");
  renamePalette(id, "   ");
  hydratePalettes(storage);
  expect(usePaletteStore.getState().palettes).toEqual([{ id, name: "Keep", swatches: [stone, woodWall] }]);
  deletePalette(id);
  expect(usePaletteStore.getState().palettes).toEqual([]);
});

test("recent swatches put the latest first, once each, and keep sixteen", () => {
  for (let id = 0; id < 20; id++) pushRecentSwatch({ layer: "wall", id: id + 1, paint: 0 });
  pushRecentSwatch({ layer: "wall", id: 10, paint: 0 });
  const recent = usePaletteStore.getState().recent;
  expect(recent).toHaveLength(16);
  expect(recent[0]).toEqual({ layer: "wall", id: 10, paint: 0 });
  expect(recent.filter((swatch) => swatch.id === 10)).toHaveLength(1);
});

test("exported palettes import as new palettes; other files and corrupt entries are refused or dropped", () => {
  const id = createPalette("Desert", [stone, woodWall]);
  const file = exportPalettes([id]);
  expect(importPalettes(file)).toBe(1);
  const [original, imported] = usePaletteStore.getState().palettes;
  expect(imported?.name).toBe("Desert");
  expect(imported?.swatches).toEqual(original?.swatches);
  expect(imported?.id).not.toBe(original?.id);
  expect(() => importPalettes("not json")).toThrow(/not JSON/);
  expect(() => importPalettes(JSON.stringify({ palettes: [] }))).toThrow(/not a Terraria Map Studio palette file/);
  hydratePalettes(memory({ [PALETTES_STORAGE_KEY]: JSON.stringify({ palettes: [{ name: "Mixed", swatches: [stone, { layer: "liquid", id: 1 }, { layer: "wall", id: -2 }] }, { swatches: [] }], recent: "nope" }) }));
  expect(usePaletteStore.getState().palettes.map(({ name, swatches }) => ({ name, swatches }))).toEqual([{ name: "Mixed", swatches: [stone] }]);
  expect(usePaletteStore.getState().recent).toEqual([]);
});
