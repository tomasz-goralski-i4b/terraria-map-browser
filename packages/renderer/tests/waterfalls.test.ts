// Waterfalls (docs/assets.md, "Waterfalls"): where the game starts one and the pieces its stream draws, over synthetic
// worlds worked out by hand.
import { describe, expect, test } from "vitest";
import { WATERFALL_SHEETS, waterfallSources, waterfallSprites } from "../src/index.js";
import type { WaterfallSource, WaterfallWorld } from "../src/index.js";

const ABSENT = 0xffff;
const STONE = 0;
const PLATFORM = 1;
const ROPE = 2;
const COBWEB = 3;

/**
 * A world from rows of characters: `#` stone, `h` half block, `\` slope going down to the right, `/` slope going down
 * to the left, `p` a platform (stored frame), `r` a rope, `w` a cobweb, `~` water 255, `,` water 100, `l` lava 255,
 * `.` air.
 */
function world(rows: readonly string[]): WaterfallWorld {
  const height = rows.length;
  const width = rows[0]?.length ?? 0;
  const count = width * height;
  const block = new Uint16Array(count).fill(ABSENT);
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
      if (char === "p") block[i] = PLATFORM;
      if (char === "r") block[i] = ROPE;
      if (char === "w") block[i] = COBWEB;
      if (char === "~" || char === "l" || char === ",") { liquid[i] = char === "l" ? 2 : 1; liquidAmount[i] = char === "," ? 100 : 255; }
    });
  });
  return {
    width, height, palette: [{ kind: "vanilla", id: 1 }, { kind: "vanilla", id: 19 }, { kind: "vanilla", id: 213 }, { kind: "vanilla", id: 51 }],
    planes: { block, shape, liquid, liquidAmount },
  };
}

const all = (w: WaterfallWorld): WaterfallSource[] => waterfallSources(w, { left: 0, top: 0, right: w.width, bottom: w.height });

describe("waterfall sources", () => {
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

/** A stream's sprites as "sx,sy,width,height@dx,dy" (+ "f" when mirrored, "/alpha" when not opaque). */
function sprites(w: WaterfallWorld): string[] {
  return waterfallSprites(w, { left: 0, top: 0, right: w.width, bottom: w.height }).map((sprite) => {
    const alpha = sprite.alpha === undefined || sprite.alpha === 255 ? "" : `/${String(sprite.alpha)}`;
    return `${String(sprite.sx)},${String(sprite.sy)},${String(sprite.width)},${String(sprite.height)}@${String(sprite.dx)},${String(sprite.dy)}${sprite.flip === true ? "f" : ""}${alpha}`;
  });
}

describe("waterfall streams", () => {
  test("a film over the source, the lip where it starts to fall, the column, then the foot and a film along the floor", () => {
    const w = world(["......", "#~h...", "###...", "......", "######"]);
    expect(sprites(w).slice(0, 6)).toEqual([
      "16,0,16,16@32,16f", // over the half block, flowing right
      "0,0,16,16@48,16f", // the lip over the edge
      "0,24,32,16@32,32f", // the column
      "0,24,32,8@32,48f", // its foot on the floor
      "16,0,16,16@48,56f", // the film along the floor, 8 pixels down
      "16,0,16,16@64,56f",
    ]);
    for (const sprite of waterfallSprites(w, { left: 0, top: 0, right: 6, bottom: 5 })) {
      expect(sprite).toMatchObject({ kind: "waterfall", id: WATERFALL_SHEETS[0], behind: true });
    }
  });

  test("against a wall it turns back once; the second wall ends it", () => {
    const films = sprites(world(["......", "#~h...", "###...", "......", "######"])).filter((sprite) => sprite.startsWith("16,0,16,16@") && sprite.includes(",56"));
    // Right to the world's edge (x 3–5), back to the left edge (x 4–0).
    expect(films.map((sprite) => sprite.slice(sprite.indexOf("@") + 1))).toEqual([
      "48,56f", "64,56f", "80,56", "64,56", "48,56", "32,56", "16,56", "0,56",
    ]);
  });

  test("it ends in the liquid it falls into", () => {
    const pool = sprites(world(["......", "#~h...", "###...", "...~~~", "######"]));
    expect(pool).toEqual(["16,0,16,16@32,16f", "0,0,16,16@48,16f", "0,24,32,16@32,32f", "0,24,32,8@32,48f"]);
  });

  test("lava and honey keep their opacity; water falls at 0.6 below the surface", () => {
    const lava = world(["......", "#lh...", "###...", "......", "######"]);
    expect(waterfallSprites(lava, { left: 0, top: 0, right: 6, bottom: 5 })[0]).toMatchObject({ id: WATERFALL_SHEETS[1], alpha: 255 });
    const deep = { ...world(["......", "#~h...", "###...", "......", "######"]), surfaceY: 0 };
    expect(sprites(deep)[0]).toBe("16,0,16,16@32,16f/153");
  });
});
