// Opt-in (docs/assets.md, "Opt-in integration test"): needs TERRARIA_CONTENT; CI never sets it, and the test then
// reports itself as skipped. Nothing it builds or draws is written anywhere.
import { afterEach, expect, test } from "vitest";
import { commands } from "vitest/browser";
import { MISSING_SPRITE_COLORS, createMapRenderer, terrariaMapPalette } from "@studio/renderer";
import type { BlockFraming } from "@studio/renderer";
import type { MapRenderer, SpriteAtlasSource, SpriteSheetEntry } from "@studio/renderer";
import { readWorldTiles } from "@studio/world-codec";
import { getBlockFraming } from "../src/world/block-framing.js";
import { toRenderableWorld } from "../src/world/renderable-world.js";
import "./support/commands.js";

const created: MapRenderer[] = [];
afterEach(() => {
  for (const renderer of created.splice(0)) renderer.dispose();
});

const ZOOM = 16;
/** Tiles drawn around the spawn point. */
const AREA = { width: 48, height: 32 };

function decodeBase64(text: string): Uint8Array {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function draw(
  world: ReturnType<typeof toRenderableWorld>, x: number, y: number, atlas: SpriteAtlasSource | null, framing: BlockFraming | null = null,
): Uint8Array {
  const canvas = document.createElement("canvas");
  canvas.width = AREA.width * ZOOM;
  canvas.height = AREA.height * ZOOM;
  const renderer = createMapRenderer(canvas, { mapPalette: terrariaMapPalette });
  created.push(renderer);
  renderer.setWorld(world);
  renderer.setAtlas(atlas);
  renderer.setSpriteMode(atlas !== null);
  renderer.setFraming(framing);
  renderer.setCamera({ x, y, zoom: ZOOM });
  renderer.render();
  const gl = canvas.getContext("webgl2");
  if (gl === null) throw new Error("no webgl2 context");
  expect(gl.getError()).toBe(gl.NO_ERROR);
  const pixels = new Uint8Array(canvas.width * canvas.height * 4);
  gl.readPixels(0, 0, canvas.width, canvas.height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return pixels;
}

test("TERRARIA_CONTENT: the spawn area of SCCO1.wld draws its frame-important tiles from the local sprites", async (context) => {
  const loaded = readWorldTiles(decodeBase64(await commands.readWorldFixture("SCCO1.wld")));
  const world = toRenderableWorld(loaded);
  const { spawn } = loaded.details.spawnAndLandmarks;
  const left = Math.max(0, spawn.x - AREA.width / 2);
  const top = Math.max(0, spawn.y - AREA.height / 2);

  // The vanilla tile IDs placed with a stored frame in the area: the sheets the atlas needs.
  const { block, frameX } = loaded.planes;
  const ids = new Set<number>();
  for (let x = left; x < left + AREA.width; x++) {
    for (let y = top; y < top + AREA.height; y++) {
      const index = x * world.height + y;
      const ref = loaded.palette[block[index] ?? 0xffff];
      if (ref?.kind === "vanilla" && (frameX[index] ?? -1) >= 0) ids.add(ref.id);
    }
  }
  expect(ids.size, "the spawn area has frame-important tiles").toBeGreaterThan(0);

  const local = await commands.buildLocalAtlas([...ids]);
  if (local === null) {
    context.skip("TERRARIA_CONTENT is not set");
    return;
  }
  expect(local.missing, "every needed sheet decodes").toBe(0);
  const atlas: SpriteAtlasSource = {
    pages: local.pages.map(decodeBase64),
    index: { pageSize: local.pageSize, entries: local.entries as SpriteSheetEntry[] },
  };
  const sheets = new Set(atlas.index.entries.filter((entry) => entry.kind === "tile").map((entry) => entry.id));
  // The atlas holds the area's sheets only, so only the area is checked.
  expect([...ids].filter((id) => !sheets.has(id)), "every framed tile of the area has a sheet").toEqual([]);

  const sprites = draw(world, left, top, atlas);
  const map = draw(world, left, top, null);
  // Sprites changed the picture, and none of it is the missing-texture checkerboard.
  expect(sprites).not.toEqual(map);
  const [magenta] = MISSING_SPRITE_COLORS;
  let checkerboard = 0;
  for (let i = 0; i < sprites.length; i += 4) {
    if (sprites[i] === magenta?.[0] && sprites[i + 1] === magenta?.[1] && sprites[i + 2] === magenta?.[2]) checkerboard++;
  }
  expect(checkerboard).toBe(0);
}, 120_000);

test("TERRARIA_CONTENT: with the block framing, the spawn area's self-framed blocks draw sprites too", async (context) => {
  const loaded = readWorldTiles(decodeBase64(await commands.readWorldFixture("SCCO1.wld")));
  const world = toRenderableWorld(loaded);
  const { spawn } = loaded.details.spawnAndLandmarks;
  const left = Math.max(0, spawn.x - AREA.width / 2);
  const top = Math.max(0, spawn.y - AREA.height / 2);
  const framing = await getBlockFraming();

  // Every vanilla block of the area, and how many of them are self-framed (no stored frame, depth ≥ 0).
  const { block, frameX } = loaded.planes;
  const ids = new Set<number>();
  let selfFramed = 0;
  for (let x = left; x < left + AREA.width; x++) {
    for (let y = top; y < top + AREA.height; y++) {
      const index = x * world.height + y;
      const ref = loaded.palette[block[index] ?? 0xffff];
      if (ref?.kind !== "vanilla") continue;
      ids.add(ref.id);
      if ((frameX[index] ?? -1) < 0 && framing.depth(ref.id) >= 0) selfFramed++;
    }
  }
  expect(selfFramed, "the spawn area has self-framed blocks").toBeGreaterThan(0);

  const local = await commands.buildLocalAtlas([...ids]);
  if (local === null) {
    context.skip("TERRARIA_CONTENT is not set");
    return;
  }
  const atlas: SpriteAtlasSource = {
    pages: local.pages.map(decodeBase64),
    index: { pageSize: local.pageSize, entries: local.entries as SpriteSheetEntry[] },
  };
  const framed = draw(world, left, top, atlas, framing);
  const unframed = draw(world, left, top, atlas);
  // Framing changed the self-framed blocks' pixels, and none of them is the missing-texture checkerboard.
  let changed = 0;
  let checkerboard = 0;
  const [magenta] = MISSING_SPRITE_COLORS;
  for (let i = 0; i < framed.length; i += 4) {
    if (framed[i] !== unframed[i] || framed[i + 1] !== unframed[i + 1] || framed[i + 2] !== unframed[i + 2]) changed++;
    if (framed[i] === magenta?.[0] && framed[i + 1] === magenta?.[1] && framed[i + 2] === magenta?.[2]) checkerboard++;
  }
  expect(changed).toBeGreaterThan(selfFramed * ZOOM);
  expect(checkerboard).toBe(0);
}, 120_000);
