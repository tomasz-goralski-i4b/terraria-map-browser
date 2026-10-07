import { expect, test } from "vitest";
import { createMapPaletteImporter, MAP_PALETTE_STORAGE_KEY } from "../src/world/map-palette-importer.js";

const exportedPalette = {
  schemaVersion: 1, gameVersion: "1.4.5.8",
  tiles: [[[118, 88, 62]], [[108, 112, 120]]],
  walls: [[], [[82, 86, 92]]],
  liquids: [[32, 104, 210], [228, 68, 24], [222, 164, 36], [152, 84, 216]],
};

test("world-load importer restores a previously imported palette from this origin", () => {
  const data = new Map([[MAP_PALETTE_STORAGE_KEY, JSON.stringify(exportedPalette)]]);
  const importer = createMapPaletteImporter({
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  });
  expect(importer.load()?.tiles[1]?.[0]).toEqual([108, 112, 120]);
});

test("invalid input preserves the last usable palette and never overwrites storage", () => {
  const data = new Map<string, string>();
  const importer = createMapPaletteImporter({
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => { data.set(key, value); },
    removeItem: (key) => { data.delete(key); },
  });
  const accepted = importer.importJson(JSON.stringify(exportedPalette));
  expect(() => importer.importJson('{"schemaVersion":2}')).toThrow();
  expect(importer.load()).toBe(accepted);
  expect(JSON.parse(data.get(MAP_PALETTE_STORAGE_KEY) ?? "null")).toEqual(exportedPalette);
  importer.clear();
  expect(importer.load()).toBeNull();
});

test("unavailable storage still permits importing for the current page session", () => {
  const importer = createMapPaletteImporter({
    getItem: () => { throw new Error("Storage disabled"); },
    setItem: () => { throw new Error("Storage quota exceeded"); },
    removeItem: () => { throw new Error("Storage disabled"); },
  });
  const palette = importer.importJson(JSON.stringify(exportedPalette));
  expect(importer.load()).toBe(palette);
  expect(importer.notice()).toContain("session");
});
