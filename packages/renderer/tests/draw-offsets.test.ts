// How the game draws frame-important tiles (docs/assets.md, "Draw offsets"): the observed draw size, top offset and
// mirroring of a frame, and the object sprites the viewer draws them as.
import { describe, expect, test } from "vitest";
import { DRAW_STAGE, DRAWN_TILES, drawStage, drawVariant, objectSprites } from "../src/index.js";
import type { ObjectWorld } from "../src/index.js";

describe("draw variants (R)", () => {
  test("plants are 16 × 20, mirrored at even x; torches 20 × 20; candles drawn 4 pixels up; piles 2 down", () => {
    expect(drawVariant(3, 36, 0)).toEqual([16, 20, 0, 1, 0]);
    expect(drawVariant(4, 0, 66)).toEqual([20, 20, 0, 0, 0]);
    expect(drawVariant(33, 0, 0)).toEqual([16, 20, -4, 0, 0]);
    expect(drawVariant(185, 54, 0)).toEqual([16, 16, 2, 0, 0]);
  });

  test("a chest's bottom row reaches 2 pixels into the floor; its top row is a plain cell", () => {
    expect(drawVariant(21, 36, 18)).toEqual([16, 18, 0, 0, 0]);
    expect(drawVariant(21, 36, 0)).toEqual([16, 16, 0, 0, 0]);
  });

  test("stalactites hang 2 pixels higher and stalagmites stand 2 pixels lower (G, as the game's moss plants 184, R)", () => {
    for (const fy of [0, 18, 72]) expect(drawVariant(165, 54, fy)).toEqual([16, 16, -2, 0, 0]);
    for (const fy of [36, 54, 90]) expect(drawVariant(165, 54, fy)).toEqual([16, 16, 2, 0, 0]);
    expect(DRAWN_TILES.has(165)).toBe(true);
    // Another row is still drawn, as a plain cell: the chunk pass leaves the whole type to the object pass.
    expect(drawVariant(165, 0, 108)).toEqual([16, 16, 0, 0, 0]);
  });

  test("blocks and plain frame-important tiles have no variant", () => {
    expect(drawVariant(1, 0, 0)).toBeUndefined();
    expect(drawVariant(13, 0, 0)).toBeUndefined();
    expect(DRAWN_TILES.has(3)).toBe(true);
    expect(DRAWN_TILES.has(13)).toBe(false);
  });
});

/** A world with one tile of `type` at (x, y) and stored frames (fx, fy). */
function oneTile(type: number, x: number, y: number, fx: number, fy: number): ObjectWorld {
  const width = 8, height = 6, count = width * height;
  const block = new Uint16Array(count).fill(0xffff);
  const frameX = new Int16Array(count).fill(-1);
  const frameY = new Int16Array(count).fill(-1);
  block[x * height + y] = 0;
  frameX[x * height + y] = fx;
  frameY[x * height + y] = fy;
  return { width, height, planes: { block, frameX, frameY }, palette: [{ kind: "vanilla", id: type }] };
}

const AREA = { left: 0, top: 0, right: 8, bottom: 6 };

describe("drawn tiles as object sprites", () => {
  test("a plant is drawn 16 × 20 from its tile's top, mirrored only at an even x, in the plants' stage", () => {
    expect(objectSprites(oneTile(3, 5, 3, 36, 0), AREA)).toEqual([
      { kind: "tile", id: 3, sx: 36, sy: 0, width: 16, height: 20, dx: 5 * 16, dy: 3 * 16, flip: false, behind: true, row: 3, stage: DRAW_STAGE.plants },
    ]);
    expect(objectSprites(oneTile(3, 4, 3, 36, 0), AREA)[0]?.flip).toBe(true);
  });

  test("a torch is centred on its tile; a candle drawn 4 pixels above it", () => {
    expect(objectSprites(oneTile(4, 2, 2, 0, 0), AREA)[0]).toMatchObject({ width: 20, height: 20, dx: 2 * 16 - 2, dy: 2 * 16 });
    expect(objectSprites(oneTile(33, 2, 2, 0, 0), AREA)[0]).toMatchObject({ width: 16, height: 20, dx: 2 * 16, dy: 2 * 16 - 4 });
  });

  test("a hanging lantern is drawn 2 pixels above its tiles, 10 under a platform, ordered by its top tile's row", () => {
    const lantern = (platform: boolean): ObjectWorld => {
      const world = oneTile(42, 5, 3, 0, 0);
      const { block, frameX, frameY } = world.planes;
      block[5 * 6 + 4] = 0;
      if (frameX !== undefined) frameX[5 * 6 + 4] = 0;
      if (frameY !== undefined) frameY[5 * 6 + 4] = 18;
      if (platform) block[5 * 6 + 2] = 1;
      return { ...world, palette: [{ kind: "vanilla", id: 42 }, { kind: "vanilla", id: 19 }] };
    };
    const tiles = (world: ObjectWorld) => objectSprites(world, AREA).filter((sprite) => sprite.id === 42);
    expect(tiles(lantern(false)).map(({ dy, row, stage }) => [dy, row, stage])).toEqual([
      [3 * 16 - 2, 3, DRAW_STAGE.hanging], [4 * 16 - 2, 3, DRAW_STAGE.hanging],
    ]);
    expect(tiles(lantern(true)).map(({ dy }) => dy)).toEqual([3 * 16 - 10, 4 * 16 - 10]);
  });

  test("the stages after the tiles that are not solid: hanging objects, swaying ones, plants, moss, tree foliage", () => {
    expect([DRAW_STAGE.hanging, DRAW_STAGE.swaying, DRAW_STAGE.plants, DRAW_STAGE.moss, DRAW_STAGE.foliage]).toEqual([0, 1, 2, 3, 4]);
    expect(drawStage(34, 0)).toBe(DRAW_STAGE.hanging);
    expect(drawStage(91, 18)).toBe(DRAW_STAGE.hanging);
    expect(drawStage(27, 18)).toBe(DRAW_STAGE.swaying);
    expect(drawStage(530, 216)).toBe(DRAW_STAGE.swaying);
    expect(drawStage(530, 270)).toBeUndefined();
    expect(drawStage(3, 0)).toBe(DRAW_STAGE.plants);
    expect(drawStage(227, 204)).toBeUndefined();
    expect(drawStage(184, 0)).toBe(DRAW_STAGE.moss);
    expect(drawStage(21, 0)).toBeUndefined();
    // Types without draw data of their own are drawn by the object pass as plain cells, so they can take their stage.
    expect(DRAWN_TILES.has(42)).toBe(true);
    expect(drawVariant(42, 0, 0)).toEqual([16, 16, 0, 0, 0]);
  });

  test("a tile without a stored frame, or of a plain type, is not an object sprite", () => {
    expect(objectSprites(oneTile(3, 2, 2, -1, -1), AREA)).toEqual([]);
    expect(objectSprites(oneTile(13, 2, 2, 0, 0), AREA)).toEqual([]);
  });
});
