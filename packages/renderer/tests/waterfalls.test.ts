// Waterfalls (docs/assets.md, "Waterfalls"): where the game starts one (observed at runtime, R) and the path it takes
// (in-game screenshots, G), as sources and pieces over synthetic worlds.
import { describe, expect, test } from "vitest";
import { WATERFALL_FADE_STEPS, WATERFALL_MAX_LENGTH, waterfallPath, waterfallSources } from "../src/index.js";
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
