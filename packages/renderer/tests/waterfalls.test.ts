// Waterfalls (docs/assets.md, "Waterfalls"): where the game starts one (observed at runtime, R) and the path it takes
// (in-game screenshots, G), as sources and pieces over synthetic worlds.
import { describe, expect, test } from "vitest";
import { WATERFALL_FADE_STEPS, WATERFALL_MAX_LENGTH, WATERFALL_SHEETS, waterfallPath, waterfallSources, waterfallSprites } from "../src/index.js";
import type { WaterfallSource, WaterfallWorld } from "../src/index.js";

const ABSENT = 0xffff;
const STONE = 0;
const PLATFORM = 1;

/**
 * A world from rows of characters: `#` stone, `h` half block, `\` slope going down to the right, `/` slope going down
 * to the left, `p` a platform (stored frame), `~` water 255, `,` water 100, `l` lava 255, `.` air.
 */
function world(rows: readonly string[]): WaterfallWorld {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const count = width * height;
  const block = new Uint16Array(count).fill(ABSENT);
  const frameX = new Int16Array(count).fill(-1);
  const shape = new Uint8Array(count);
  const liquid = new Uint8Array(count);
  const liquidAmount = new Uint8Array(count);
  rows.forEach((row, y) => {
    Array.from(row).forEach((char, x) => {
      const i = x * height + y;
      if ("#h\\/".includes(char)) block[i] = STONE;
      if (char === "h") shape[i] = 1;
      if (char === "\\") shape[i] = 2;
      if (char === "/") shape[i] = 3;
      if (char === "p") { block[i] = PLATFORM; frameX[i] = 0; }
      if (char === "~" || char === "l" || char === ",") { liquid[i] = char === "l" ? 2 : 1; liquidAmount[i] = char === "," ? 100 : 255; }
    });
  });
  return {
    width, height, palette: [{ kind: "vanilla", id: 1 }, { kind: "vanilla", id: 19 }],
    planes: { block, frameX, shape, liquid, liquidAmount },
  };
}

const all = (w: WaterfallWorld): WaterfallSource[] => waterfallSources(w, { left: 0, top: 0, right: w.width, bottom: w.height });

describe("waterfall sources (R)", () => {
  test("a half block with full liquid on one side and air on the other starts a waterfall flowing away from the liquid", () => {
    expect(all(world(["...", "~h.", "..."]))).toEqual([{ x: 1, y: 1, direction: 1, kind: 1 }]);
    expect(all(world(["...", ".hl", "..."]))).toEqual([{ x: 1, y: 1, direction: -1, kind: 2 }]);
  });

  test("the open side may hold a half block or a platform; a block, a slope or any liquid there stops it", () => {
    expect(all(world(["...", "~hh", "..."])).length).toBe(1);
    expect(all(world(["...", "~hp", "..."])).length).toBe(1);
    for (const other of ["#", "\\", "/", "~", ","]) expect(all(world(["...", `~h${other}`, "..."]))).toEqual([]);
  });

  test("liquid above the half block stops it; what lies below does not matter", () => {
    expect(all(world([".~.", "~h.", "..."]))).toEqual([]);
    expect(all(world(["...", "~h.", ".#."])).length).toBe(1);
    expect(all(world(["...", "~h.", ".~."])).length).toBe(1);
  });

  test("the liquid beside it must be more than 160; a slope or full block is never a source", () => {
    expect(all(world(["...", ",h.", "..."]))).toEqual([]);
    expect(all(world(["...", "~#.", "..."]))).toEqual([]);
    expect(all(world(["...", "~\\.", "..."]))).toEqual([]);
  });

  test("only sources inside the area are listed", () => {
    const w = world(["...", "~h.", "..."]);
    expect(waterfallSources(w, { left: 2, top: 0, right: 3, bottom: 3 })).toEqual([]);
  });
});

/** The tiles a path's pieces cover, by kind, as "x,y". */
function steps(w: WaterfallWorld, source: WaterfallSource): string[] {
  return waterfallPath(w, source).map((step) => `${step.piece}:${String(step.x)},${String(step.y)}`);
}

describe("waterfall paths (G)", () => {
  test("falls beside the half block to the floor, then runs along it to the world's edge", () => {
    const w = world(["#~h..", "###..", ".....", ".....", "#####"]);
    const [source] = all(w);
    if (source === undefined) throw new Error("no source");
    expect(steps(w, source)).toEqual(["lip:2,0", "fall:3,1", "fall:3,2", "fall:3,3", "run:3,3", "run:4,3"]);
  });

  test("lands on a ledge, runs along it and pours over its end", () => {
    const w = world(["~h.....", "#......", "..##...", ".......", "#######"]);
    const [source] = all(w);
    if (source === undefined) throw new Error("no source");
    expect(steps(w, source)).toEqual(["lip:1,0", "fall:2,1", "run:2,1", "lip:3,1", "fall:4,2", "fall:4,3", "run:4,3", "run:5,3", "run:6,3"]);
  });

  test("slides down a slope going away, then falls off its end", () => {
    const w = world(["~h....", "#.....", "..\\...", "...\\..", "......", "######"]);
    const [source] = all(w);
    if (source === undefined) throw new Error("no source");
    expect(steps(w, source)).toEqual(["lip:1,0", "fall:2,1", "slide:2,2", "slide:3,3", "fall:4,4", "run:4,4", "run:5,4"]);
  });

  test("on a slope going down towards it the stream turns back", () => {
    const w = world(["~h....", "#.....", "......", "../...", "......", "######"]);
    const [source] = all(w);
    if (source === undefined) throw new Error("no source");
    expect(steps(w, source)).toEqual(["lip:1,0", "fall:2,1", "fall:2,2", "slide:2,3", "fall:1,4", "run:1,4", "run:0,4"]);
  });

  test("stops at liquid it falls into and against a wall it runs into", () => {
    const pool = world(["~h...", "#....", ".....", "..~~~", "#####"]);
    const [into] = all(pool);
    if (into === undefined) throw new Error("no source");
    expect(steps(pool, into)).toEqual(["lip:1,0", "fall:2,1", "fall:2,2"]);
    const walled = world(["~h...", "#....", "..#..", "..#.#", "#####"]);
    const [blocked] = all(walled);
    if (blocked === undefined) throw new Error("no source");
    // A one-tile ledge pours over at once; the stream then lands against a wall and stops there.
    expect(steps(walled, blocked)).toEqual(["lip:1,0", "fall:2,1", "lip:2,1", "fall:3,2", "fall:3,3", "run:3,3"]);
  });

  test("flows left when the liquid lies to its right", () => {
    const w = world(["..h~#", "..###", ".....", "#####"]);
    const [source] = all(w);
    if (source === undefined) throw new Error("no source");
    expect(source.direction).toBe(-1);
    expect(steps(w, source)).toEqual(["lip:2,0", "fall:1,1", "fall:1,2", "run:1,2", "run:0,2"]);
  });

  test(`ends after ${String(WATERFALL_MAX_LENGTH)} steps, fading over the last ${String(WATERFALL_FADE_STEPS)}`, () => {
    const rows = ["~h.", "##.", ...Array.from({ length: 150 }, () => "...")];
    const w = world(rows);
    const [source] = all(w);
    if (source === undefined) throw new Error("no source");
    const path = waterfallPath(w, source);
    expect(path.length).toBe(WATERFALL_MAX_LENGTH);
    expect(path[0]?.alpha).toBe(255);
    expect(path[WATERFALL_MAX_LENGTH - WATERFALL_FADE_STEPS - 1]?.alpha).toBe(255);
    const last = path[WATERFALL_MAX_LENGTH - 1]?.alpha ?? 255;
    expect(last).toBeGreaterThan(0);
    expect(last).toBeLessThan(64);
  });
});

describe("waterfall sprites", () => {
  test("a lip, its falling column and the run on the floor, mirrored for a waterfall flowing right", () => {
    const w = world(["#~h..", "###..", ".....", "#####"]);
    const sprites = waterfallSprites(w, { left: 0, top: 0, right: w.width, bottom: w.height });
    const common = { kind: "waterfall", id: 0, flip: true, alpha: 255 };
    expect(sprites.slice(0, 4)).toEqual([
      // The lip: its flat part over the half block (2, 0), its column part hanging 6 pixels into the tile beside it.
      { ...common, sx: 10, sy: 0, width: 22, height: 24, dx: 2 * 16, dy: 0 },
      // The column down the side of (3, 1) and (3, 2) facing the source, 4 pixels over the half block's column.
      { ...common, sx: 10, sy: 24, width: 10, height: 16, dx: 3 * 16 - 4, dy: 16 },
      { ...common, sx: 10, sy: 24, width: 10, height: 16, dx: 3 * 16 - 4, dy: 32 },
      // The run: the lip's flat part, 8 pixels high, on the floor below (3, 2).
      { ...common, sx: 16, sy: 0, width: 16, height: 8, dx: 3 * 16, dy: 3 * 16 - 8 },
    ]);
  });

  test("at a ledge's end the film runs over the ledge and only the lip's corner hangs past it", () => {
    const w = world(["~h....", "#.....", "..#...", "......", "######"]);
    const sprites = waterfallSprites(w, { left: 0, top: 0, right: w.width, bottom: w.height });
    const common = { kind: "waterfall", id: 0, flip: true, alpha: 255 };
    // Steps: lip (1, 0), fall (2, 1), lip (2, 1) at the one-tile ledge (2, 2), its top at y 32.
    expect(sprites.slice(2, 4)).toEqual([
      { ...common, sx: 16, sy: 0, width: 16, height: 8, dx: 2 * 16, dy: 2 * 16 - 8 },
      { ...common, sx: 10, sy: 0, width: 10, height: 24, dx: 3 * 16 - 4, dy: 2 * 16 - 8 },
    ]);
  });

  test("down a step of one tile the stream shows the film and a 16-pixel corner, no falling column (G)", () => {
    // A staircase down to the right: the source pours onto the first step, which drops one tile to the second.
    const w = world(["~h....", "#.....", "..##..", "....##", "......", "######"]);
    const sprites = waterfallSprites(w, { left: 0, top: 0, right: w.width, bottom: w.height });
    // Steps: lip (1, 0), fall (2, 1), run (2, 1), lip (3, 1), fall (4, 2), run (4, 2), lip (5, 2)…
    const corners = sprites.filter((s) => s.sx === 10 && s.sy === 0 && s.width === 10);
    expect(corners[0]).toMatchObject({ height: 16, dx: 4 * 16 - 4, dy: 2 * 16 - 8 });
    // No column on the one-tile drop below that corner (4, 2); the source's own drop (2, 1) keeps its column.
    const columns = sprites.filter((s) => s.sy === 24);
    expect(columns.map((s) => s.dy / 16)).toEqual([1]);
  });

  test("past a slope going down towards it the column falls straight on: no slide film, no sideways jump (G)", () => {
    const w = world(["~h....", "#.....", "......", "../...", "......", "######"]);
    const sprites = waterfallSprites(w, { left: 0, top: 0, right: w.width, bottom: w.height });
    // Steps: lip (1, 0), fall (2, 1), fall (2, 2), slide (2, 3), fall (1, 4), run…: one column, x 28–38, rows 1–4.
    const columns = sprites.filter((s) => s.sy === 24);
    expect(columns.map((s) => [s.dx, s.dy / 16, s.flip])).toEqual([[28, 1, true], [28, 2, true], [28, 3, true], [28, 4, true]]);
    expect(sprites.filter((s) => s.width === 2)).toEqual([]);
  });

  test("lava, honey and shimmer draw from Waterfall_1, Waterfall_14 and Waterfall_25; a left-flowing one is not mirrored", () => {
    expect(WATERFALL_SHEETS).toEqual([0, 1, 14, 25]);
    const w = world(["..hl#", "..###", ".....", "#####"]);
    const [lip] = waterfallSprites(w, { left: 0, top: 0, right: w.width, bottom: w.height });
    expect(lip).toEqual({ kind: "waterfall", id: 1, flip: false, alpha: 255, sx: 10, sy: 0, width: 22, height: 24, dx: 2 * 16 - 6, dy: 0 });
  });

  test("a shimmer waterfall's grey sheet is tinted by shimmer's colour; the others are not", () => {
    const shimmer = world(["...", ".h.", "..."]);
    shimmer.planes.liquid[0 * 3 + 1] = 4;
    shimmer.planes.liquidAmount[0 * 3 + 1] = 255;
    const area = { left: 0, top: 0, right: 3, bottom: 3 };
    expect(waterfallSprites(shimmer, area)[0]).toMatchObject({ id: 25, tint: true });
    expect(waterfallSprites(world(["...", "~h.", "..."]), area)[0]?.tint).toBeUndefined();
  });
});
