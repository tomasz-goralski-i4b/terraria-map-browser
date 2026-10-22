// The object layout exporter on a small synthetic observation (ADR 0003). Needs packages/world-model built.
import { test } from "node:test";
import assert from "node:assert/strict";
import { exportLayouts, moduleText } from "./export.mjs";

const chestLayout = {
  width: 2, height: 2, origin: [0, 1], horizontal: true, wrap: 0, multiplier: 1, lineSkip: 1,
  fullWidth: 36, fullHeight: 38, coordinateWidth: 16, padding: 2, heights: [16, 18],
};
const chest = (style, rows = [0, 1]) => rows.flatMap((dy) => [0, 1].map((dx) => [dx, dy, style * 36 + dx * 18, dy * 18]));
const observation = (types) => ({ gameVersion: "v0", tileCount: 10, complete: true, types });

test("a layout that reproduces every placed style is written with the item style count", () => {
  const { layouts, skipped } = exportLayouts(observation([
    { type: 21, layout: chestLayout, itemStyles: 3, styles: [0, 1, 2].map((style) => ({ style, tiles: chest(style) })) },
  ]));
  assert.deepEqual(skipped, []);
  assert.deepEqual(layouts[21], {
    cellX: [0, 18], cellY: [0, 18], styleWidth: 36, styleHeight: 38, horizontal: true, wrap: 0, multiplier: 1, lineSkip: 1, styles: 3,
  });
});

test("a style of another shape inside its own cell is irregular; one outside it rejects the type", () => {
  const styles = [{ style: 0, tiles: chest(0) }, { style: 1, tiles: chest(1, [0]) }];
  assert.deepEqual(exportLayouts(observation([{ type: 14, layout: chestLayout, itemStyles: 0, styles }])).layouts[14]?.irregular, [1]);
  const spilling = [{ style: 0, tiles: chest(0) }, { style: 1, tiles: chest(2) }];
  assert.deepEqual(exportLayouts(observation([{ type: 14, layout: chestLayout, itemStyles: 0, styles: spilling }])).skipped,
    [[14, "style 1 is framed by more than its style"]]);
});

test("types that were not placed, are framed by neighbours or have no data are skipped with the reason", () => {
  const platform = { ...chestLayout, width: 1, height: 1, fullWidth: 18, fullHeight: 18, heights: [16] };
  const data = exportLayouts(observation([
    { type: 3, layout: chestLayout, itemStyles: 0, styles: [{ style: 0, tiles: null }] },
    { type: 5, layout: null },
    { type: 19, layout: platform, itemStyles: 0, styles: [{ style: 0, tiles: [[0, 0, 90, 0]] }] },
  ]));
  assert.deepEqual(data.layouts, {});
  assert.deepEqual(data.skipped, [[3, "style 0 not placed"], [5, "no placement data"], [19, "style 0 is not at the sheet's origin"]]);
  assert.match(moduleText(data), /\/\/ style 0 not placed: 3\n/);
});

test("an incomplete observation is refused", () => {
  assert.throws(() => exportLayouts({ ...observation([]), complete: false }), /incomplete/);
});
