import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readXnbTexture } from "../src/index.js";

// Opt-in: TERRARIA_CONTENT points at a local Terraria/Content directory (docs/assets.md, "Opt-in integration test").
// CI never sets it; the tests are then reported as skipped. Assertions only — decoded pixels are never written.
const content = process.env["TERRARIA_CONTENT"];
const images = content === undefined ? undefined : join(content, "Images");

function imageFiles(): Map<string, string> {
  const files = new Map<string, string>();
  for (const name of readdirSync(images ?? "")) files.set(name.toLowerCase(), join(images ?? "", name));
  return files;
}

function decode(files: Map<string, string>, name: string): ReturnType<typeof readXnbTexture> {
  const path = files.get(`${name}.xnb`.toLowerCase());
  if (path === undefined) throw new Error(`${name}.xnb not found in ${images ?? ""}`);
  return readXnbTexture(new Uint8Array(readFileSync(path)));
}

describe.skipIf(images === undefined || !existsSync(images))("Terraria content (TERRARIA_CONTENT)", () => {
  it("readXnbTexture_TilesZero_Is288By270", () => {
    const texture = decode(imageFiles(), "Tiles_0");
    expect([texture.width, texture.height]).toEqual([288, 270]);
    expect(texture.rgba.length).toBe(288 * 270 * 4);
  });

  it("readXnbTexture_WallOne_Is468By180", () => {
    const texture = decode(imageFiles(), "Wall_1");
    expect([texture.width, texture.height]).toEqual([468, 180]);
    expect(texture.rgba.length).toBe(468 * 180 * 4);
  });

  it("readXnbTexture_EveryTileAndWallSheet_Decodes", () => {
    const files = imageFiles();
    const names = [
      ...Array.from({ length: 754 }, (_, id) => `Tiles_${String(id)}`),
      ...Array.from({ length: 366 }, (_, id) => `Wall_${String(id + 1)}`),
    ];
    for (const name of names) {
      const texture = decode(files, name);
      expect(texture.rgba.length, name).toBe(texture.width * texture.height * 4);
    }
  });
});
