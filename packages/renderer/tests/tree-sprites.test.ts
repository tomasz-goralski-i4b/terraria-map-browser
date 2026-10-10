// Trees as object sprites (docs/assets.md, "Trees"): the sheet, cell and offset of every trunk, top and branch. The
// documented rules are written out here, so the test pins them rather than the generated table.
import { describe, expect, test } from "vitest";
import type { ContentRef } from "@studio/world-model";
import { objectSprites } from "../src/index.js";
import type { ObjectSprite, ObjectWorld, TreeSettings } from "../src/index.js";

const ABSENT = 0xffff;
const WIDTH = 40;
const HEIGHT = 30;

/** (x, y, tile id, frameX, frameY) tiles on an otherwise empty world. */
type Placed = readonly (readonly [number, number, number, number, number])[];

function world(tiles: Placed, trees?: TreeSettings): ObjectWorld {
  const ids = [...new Set(tiles.map(([, , id]) => id))];
  const palette: ContentRef[] = ids.map((id) => ({ kind: "vanilla", id }));
  const block = new Uint16Array(WIDTH * HEIGHT).fill(ABSENT);
  const frameX = new Int16Array(WIDTH * HEIGHT).fill(-1);
  const frameY = new Int16Array(WIDTH * HEIGHT).fill(-1);
  for (const [x, y, id, fx, fy] of tiles) {
    block[x * HEIGHT + y] = ids.indexOf(id);
    frameX[x * HEIGHT + y] = fx;
    frameY[x * HEIGHT + y] = fy;
  }
  return { width: WIDTH, height: HEIGHT, planes: { block, frameX, frameY }, palette, ...(trees === undefined ? {} : { trees }) };
}

const GROUND_Y = 20;

/**
 * A tree of `type` at column x standing on `ground`: trunk tiles (0, 0) from the ground up, a left branch (44, 198 +
 * 22 variant) and a right branch (66, …) beside the third trunk tile, and its top (22, …) above the fourth.
 */
function tree(x: number, type: number, ground: number, variant = 0): Placed {
  const placed: (readonly [number, number, number, number, number])[] = [];
  for (let gx = x - 2; gx <= x + 2; gx++) placed.push([gx, GROUND_Y, ground, -1, -1]);
  for (let y = GROUND_Y - 4; y < GROUND_Y; y++) placed.push([x, y, type, 0, 0]);
  placed.push([x - 1, GROUND_Y - 3, type, 44, 198 + 22 * variant]);
  placed.push([x + 1, GROUND_Y - 3, type, 66, 198 + 22 * variant]);
  placed.push([x, GROUND_Y - 5, type, 22, 198 + 22 * variant]);
  return placed;
}

const of = (sprites: readonly ObjectSprite[], kind: ObjectSprite["kind"]): ObjectSprite[] => sprites.filter((sprite) => sprite.kind === kind);
const ALL = { left: 0, top: 0, right: WIDTH, bottom: HEIGHT };

describe("tree sprites", () => {
  test("a forest tree: trunk cells 20 × 20 drawn 2 pixels left of their tile, its branches and its top from the forest style", () => {
    const sprites = objectSprites(world(tree(10, 5, 2)), ALL);
    // Trunk cells: Tiles_5 at the stored frame (block 0 on grass), the 20 × 20 cell 2 pixels left of the tile.
    expect(of(sprites, "tile")).toContainEqual({ kind: "tile", id: 5, sx: 0, sy: 0, width: 20, height: 20, dx: 158, dy: 16 * 16 });
    expect(of(sprites, "tile")).toHaveLength(7);
    // Top: Tree_Tops_0 (variation 0), frame 0, 80 × 80, centred on the tile, its bottom on the tile's bottom.
    expect(of(sprites, "treeTop")).toEqual([{ kind: "treeTop", id: 0, sx: 0, sy: 0, width: 80, height: 80, dx: 128, dy: 16 * 15 + 16 - 80 }]);
    // Branches: Tree_Branches_0, left column 0 and right column 42, 40 × 40, against the trunk, 12 pixels above the tile.
    expect(of(sprites, "treeBranch")).toEqual([
      { kind: "treeBranch", id: 0, sx: 0, sy: 0, width: 40, height: 40, dx: 16 * 9 + 16 - 40, dy: 16 * 17 - 12 },
      { kind: "treeBranch", id: 0, sx: 42, sy: 0, width: 40, height: 40, dx: 16 * 11, dy: 16 * 17 - 12 },
    ]);
    // Drawing order: the trunk cells, then the branches, then the top.
    const kinds = sprites.map((sprite) => sprite.kind);
    expect(kinds.lastIndexOf("tile")).toBeLessThan(kinds.indexOf("treeBranch"));
    expect(kinds.lastIndexOf("treeBranch")).toBeLessThan(kinds.indexOf("treeTop"));
  });

  test("the stored variant picks the top's and the branches' frame", () => {
    const sprites = objectSprites(world(tree(10, 5, 2, 2)), ALL);
    expect(of(sprites, "treeTop")[0]).toMatchObject({ id: 0, sx: 2 * 82, sy: 0 });
    expect(of(sprites, "treeBranch").map((sprite) => sprite.sy)).toEqual([2 * 42, 2 * 42]);
  });

  test("the same forest tree draws another top in another tree-style zone, by the world's tree top variations", () => {
    // Zones split at treeX: x < 15 reads variation 0, < 25 variation 1, < 35 variation 2, the rest variation 3.
    // A forest variation v names Tree_Tops_0 for v = 0 and Tree_Tops_(v + 5) otherwise.
    const trees: TreeSettings = { treeX: [15, 25, 35], treeTopVariations: [0, 1, 5, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
    const topAt = (x: number, settings: TreeSettings): number | undefined => of(objectSprites(world(tree(x, 5, 2), settings), ALL), "treeTop")[0]?.id;
    expect([5, 20, 30, 37].map((x) => topAt(x, trees))).toEqual([0, 6, 10, 7]);
    // Another world's variations: the same tree in zone 0 takes another top; its branches follow.
    const other: TreeSettings = { ...trees, treeTopVariations: [3, 1, 5, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0] };
    expect(topAt(5, other)).toBe(8);
    expect(of(objectSprites(world(tree(5, 5, 2), other), ALL), "treeBranch").map((sprite) => sprite.id)).toEqual([8, 8]);
    // Without tree settings every variation is 0.
    expect(topAt(30, { treeX: [], treeTopVariations: [] })).toBe(0);
  });

  test("the ground picks the trunk block and the top: corruption, jungle (116 × 96 tops), hallow (frames by column)", () => {
    const corrupt = objectSprites(world(tree(10, 5, 23)), ALL);
    expect(of(corrupt, "tile")[0]).toMatchObject({ id: 5, sx: 176 });
    expect(of(corrupt, "treeTop")[0]).toMatchObject({ id: 1, width: 80, height: 80 });
    const jungle = objectSprites(world(tree(10, 5, 60)), ALL);
    expect(of(jungle, "tile")[0]).toMatchObject({ sx: 6 * 176 });
    expect(of(jungle, "treeTop")[0]).toEqual({ kind: "treeTop", id: 13, sx: 0, sy: 0, width: 116, height: 96, dx: 160 + 8 - 58, dy: 16 * 15 + 16 - 96 });
    // Hallow: Tree_Tops_3, 80 × 140, frame = variant + 3 · (x mod 3), branches by their own column.
    const hallow = objectSprites(world(tree(10, 5, 109, 1)), ALL);
    expect(of(hallow, "tile")[0]).toMatchObject({ sx: 3 * 176 });
    expect(of(hallow, "treeTop")[0]).toMatchObject({ id: 3, sx: (1 + 3 * 1) * 82, width: 80, height: 140 });
    expect(of(hallow, "treeBranch").map((sprite) => sprite.sy)).toEqual([(1 + 3 * 0) * 42, (1 + 3 * 2) * 42]);
  });

  test("a gem tree draws Tiles_583 trunk cells and the Tree_Tops_22 top", () => {
    const sprites = objectSprites(world(tree(10, 583, 1)), ALL);
    expect(of(sprites, "tile")[0]).toMatchObject({ id: 583, sx: 0, sy: 0, width: 20, height: 20, dx: 158 });
    expect(of(sprites, "treeTop")).toEqual([{ kind: "treeTop", id: 22, sx: 0, sy: 0, width: 116, height: 96, dx: 110, dy: 16 * 15 + 16 - 96 }]);
    expect(of(sprites, "treeBranch").map((sprite) => sprite.id)).toEqual([22, 22]);
  });

  test("a palm: its row by the sand under it, each tile shifted by its stored lean, the top from Tree_Tops_15", () => {
    const palm: Placed = [
      ...[8, 9, 10, 11, 12].map((x) => [x, GROUND_Y, 234, -1, -1] as const),
      [10, GROUND_Y - 1, 323, 66, 0], [10, GROUND_Y - 2, 323, 22, 2], [10, GROUND_Y - 3, 323, 0, 4], [10, GROUND_Y - 4, 323, 110, 6],
    ];
    const sprites = objectSprites(world(palm), ALL);
    // Crimsand: row 1 of Tiles_323 and of Tree_Tops_15.
    // Trunk cells are drawn row by row from the top.
    expect(of(sprites, "tile")).toEqual([
      { kind: "tile", id: 323, sx: 110, sy: 22, width: 20, height: 20, dx: 164, dy: 16 * 16 },
      { kind: "tile", id: 323, sx: 0, sy: 22, width: 20, height: 20, dx: 162, dy: 16 * 17 },
      { kind: "tile", id: 323, sx: 22, sy: 22, width: 20, height: 20, dx: 160, dy: 16 * 18 },
      { kind: "tile", id: 323, sx: 66, sy: 22, width: 20, height: 20, dx: 158, dy: 16 * 19 },
    ]);
    expect(of(sprites, "treeTop")).toEqual([{ kind: "treeTop", id: 15, sx: 82, sy: 82, width: 80, height: 80, dx: 160 + 8 - 40 + 6, dy: 16 * 16 + 16 - 80 }]);
  });

  test("a palm on a ground that names no palm row draws nothing", () => {
    const sprites = objectSprites(world([[10, GROUND_Y, 1, -1, -1], [10, GROUND_Y - 1, 323, 66, 0]]), ALL);
    expect(sprites).toEqual([]);
  });

  test("the giant mushroom: 16 × 18 stem cells and its cap from Shroom_Tops by the top tile's frame", () => {
    const shroom: Placed = [[10, GROUND_Y, 70, -1, -1], [10, GROUND_Y - 1, 72, 0, 18], [10, GROUND_Y - 2, 72, 0, 0], [10, GROUND_Y - 3, 72, 36, 36]];
    const sprites = objectSprites(world(shroom), ALL);
    expect(of(sprites, "tile")).toContainEqual({ kind: "tile", id: 72, sx: 0, sy: 18, width: 16, height: 18, dx: 160, dy: 16 * 19 });
    expect(of(sprites, "shroomTop")).toEqual([{ kind: "shroomTop", id: 0, sx: 2 * 62, sy: 0, width: 60, height: 42, dx: 160 + 8 - 30, dy: 16 * 17 + 16 - 42 }]);
  });

  test("only the tiles inside the area are collected: a branch's tile left of the trunk, its trunk cell and foliage", () => {
    const placed = world(tree(10, 5, 2));
    expect(objectSprites(placed, { left: 0, top: 0, right: 10, bottom: HEIGHT }).map((sprite) => sprite.kind)).toEqual(["tile", "treeBranch"]);
    expect(objectSprites(placed, { left: 11, top: 0, right: WIDTH, bottom: HEIGHT }).map((sprite) => sprite.kind)).toEqual(["tile", "treeBranch"]);
  });
});
