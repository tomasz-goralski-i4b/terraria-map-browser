import { expect, test } from "vitest";
import { measurementDimensions, measurementLabels, measurementSegments, measurementBlocks, measurementLength, measurementSummary, hitMeasurement, snapBoundary, type Measurement } from "../src/world/measurements.js";

const diagonal: Measurement = { id: 1, name: "Roof slope", kind: "line", start: { x: 120, y: 80 }, end: { x: 123, y: 84 }, visible: true };

test("diagonal line footprints contain whole blocks and count them without an extra endpoint block", () => {
  const roof = diagonal;
  expect(measurementLength(roof)).toBe(4);
  expect(measurementBlocks(roof)).toEqual([{ x: 120, y: 80 }, { x: 121, y: 81 }, { x: 121, y: 82 }, { x: 122, y: 83 }]);
  const segments = measurementSegments(roof);
  expect(segments).not.toHaveLength(0);
  for (const [start, end] of segments) {
    expect(start.x === end.x || start.y === end.y).toBe(true);
    expect([start.x, start.y, end.x, end.y].every(Number.isInteger)).toBe(true);
  }
  expect(measurementLabels(roof, { dimensions: true, components: false, angle: false }).map((label) => label.text)).toEqual(["5 long · 4 blocks"]);
});

test("boundary distances are geometric block units, with no inclusive tile added", () => {
  expect(measurementDimensions(diagonal)).toEqual({ width: 3, height: 4, length: 5, angle: 53.13010235415598 });
  expect(measurementDimensions({ ...diagonal, end: { x: 130, y: 80 } }).length).toBe(10);
  expect(snapBoundary({ x: -2, y: 1200.8 }, { width: 4200, height: 1200 })).toEqual({ x: 0, y: 1200 });
});

test("diagonal labels name the straight length and the blocks on the path; straight lines need neither nor an angle", () => {
  expect(measurementLabels(diagonal, { dimensions: true, components: true, angle: true }).map((label) => label.text))
    .toEqual(["5 long · 4 blocks · 53.1°", "ΔX 3 · ΔY 4"]);
  expect(measurementLabels({ ...diagonal, end: { x: 130, y: 80 } }, { dimensions: true, components: false, angle: true }).map((label) => label.text))
    .toEqual(["10 blocks"]);
  expect(measurementSummary(diagonal)).toBe("4 blocks · 5 long");
  expect(measurementSummary({ ...diagonal, kind: "rectangle" })).toBe("3 × 4 blocks");
  expect(measurementLabels({ ...diagonal, kind: "rectangle" }, { dimensions: true, components: false, angle: false }).map((label) => label.text))
    .toEqual(["3 blocks", "4 blocks"]);
});

test("a line whose blocks all sit in one row or column is straight: one size, no extra length, no angle", () => {
  // Endpoints snap to boundaries, so a line dragged along a row can end one boundary lower without leaving that row.
  const row = { ...diagonal, end: { x: 144, y: 81 } };
  expect(measurementBlocks(row).every((block) => block.y === 80)).toBe(true);
  expect(measurementLabels(row, { dimensions: true, components: false, angle: true }).map((label) => label.text)).toEqual(["24 blocks"]);
  expect(measurementSummary(row)).toBe("24 blocks");
  const column = { ...diagonal, end: { x: 119, y: 104 } };
  expect(measurementLabels(column, { dimensions: true, components: false, angle: true }).map((label) => label.text)).toEqual(["24 blocks"]);
  expect(measurementSummary(column)).toBe("24 blocks");
});

test("horizontal and vertical outlines are one block thick and are identical when drawn backwards", () => {
  const horizontal = { ...diagonal, end: { x: 130, y: 80 } };
  const vertical = { ...diagonal, end: { x: 120, y: 90 } };
  expect(measurementSegments(horizontal)).toHaveLength(4);
  expect(measurementSegments(vertical)).toHaveLength(4);
  expect(measurementBlocks({ ...horizontal, start: horizontal.end, end: horizontal.start })).toEqual(measurementBlocks(horizontal).toReversed());
  expect(new Set(measurementBlocks(horizontal).map((point) => point.y))).toEqual(new Set([80]));
  expect(new Set(measurementBlocks(vertical).map((point) => point.x))).toEqual(new Set([120]));
  expect(measurementBlocks({ ...diagonal, start: diagonal.end, end: diagonal.start })).toEqual(measurementBlocks(diagonal).toReversed());
});

test("selected handles win hit testing, hidden measurements cannot be picked", () => {
  const rectangle: Measurement = { id: 2, name: "Workshop footprint", kind: "rectangle", start: { x: 120, y: 80 }, end: { x: 140, y: 90 }, visible: true };
  expect(hitMeasurement([diagonal, rectangle], { x: 120, y: 80 }, 0.5, 1)).toMatchObject({ id: 1, part: "start" });
  expect(hitMeasurement([rectangle], { x: 140, y: 80 }, 0.5, 2)).toMatchObject({ id: 2, part: "top-right" });
  expect(hitMeasurement([{ ...diagonal, visible: false }], { x: 120, y: 80 }, 0.5, 1)).toBeNull();
});
