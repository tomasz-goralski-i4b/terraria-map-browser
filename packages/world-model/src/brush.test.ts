import { describe, expect, it } from "vitest";
import { createWorld } from "./index.js";
import { BRUSH_LAYER, createBrushHistory } from "./brush.js";

describe("simple vanilla brush", () => {
  it("rasterizes a three-tile round brush as a plus, shared by paint and erase", () => {
    const world = createWorld(9, 9);
    const history = createBrushHistory(world);
    history.begin({ layer: BRUSH_LAYER.block, id: 1, size: 3, shape: "circle" });
    history.move(4, 4);
    expect(history.commit().map(({ x, y }) => [x, y])).toEqual([[3, 4], [4, 3], [4, 4], [4, 5], [5, 4]]);
    history.begin({ layer: BRUSH_LAYER.block, id: null, size: 3, shape: "circle" });
    history.move(4, 4);
    expect(history.commit()).toHaveLength(5);
    expect(world.tileAt(4, 4).block).toBeUndefined();
    history.undo();
    expect(world.tileAt(4, 4).block).toEqual({ kind: "vanilla", id: 1 });
  });
  it("uses a circular tile mask for both paint and erase, with exact history and edge clipping", () => {
    const world = createWorld(9, 9);
    const history = createBrushHistory(world);
    history.begin({ layer: BRUSH_LAYER.both, blockId: 1, wallId: 4, size: 5, shape: "circle" });
    history.move(4, 4);
    expect(history.commit()).toHaveLength(21);
    expect(world.tileAt(2, 2).block).toBeUndefined();
    expect(world.tileAt(2, 4).block).toEqual({ kind: "vanilla", id: 1 });
    history.begin({ layer: BRUSH_LAYER.both, blockId: null, wallId: null, size: 5, shape: "circle" });
    history.move(4, 4);
    expect(history.commit()).toHaveLength(21);
    history.undo();
    expect(world.tileAt(4, 4).wall).toEqual({ kind: "vanilla", id: 4 });
    history.undo();
    history.begin({ layer: BRUSH_LAYER.block, id: 38, size: 5, shape: "circle" });
    history.move(0, 0);
    expect(history.commit()).toHaveLength(8);
  });
  it("paints and erases both layers as one atomic stroke and one byte-exact undo entry", () => {
    const world = createWorld(5, 5);
    world.setTile(2, 2, { block: { kind: "vanilla", id: 0 }, wall: { kind: "vanilla", id: 2 }, wires: 9, actuator: true });
    const original = Object.values(world.planes).map((plane) => new Uint8Array(plane.buffer).slice());
    const history = createBrushHistory(world);
    history.begin({ layer: BRUSH_LAYER.both, blockId: 1, wallId: 4, size: 1 });
    history.move(2, 2);
    expect(history.commit()).toHaveLength(1);
    expect(world.tileAt(2, 2)).toEqual({ block: { kind: "vanilla", id: 1 }, wall: { kind: "vanilla", id: 4 }, wires: 9, actuator: true });
    history.undo();
    expect(Object.values(world.planes).map((plane) => new Uint8Array(plane.buffer))).toEqual(original);
    history.redo();
    history.begin({ layer: BRUSH_LAYER.both, blockId: null, wallId: null, size: 1 });
    history.move(2, 2);
    history.commit();
    expect(world.tileAt(2, 2)).toEqual({ wires: 9, actuator: true });
    history.undo();
    expect(world.tileAt(2, 2).block).toEqual({ kind: "vanilla", id: 1 });
    expect(world.tileAt(2, 2).wall).toEqual({ kind: "vanilla", id: 4 });
  });

  it("Both skips a protected wall atomically and validates both material selections before mutation", () => {
    const world = createWorld(5, 5);
    world.setTile(2, 2, { block: { kind: "vanilla", id: 0 }, wall: { kind: "vanilla", id: 87 }, wires: 0, actuator: false });
    const history = createBrushHistory(world);
    history.begin({ layer: BRUSH_LAYER.both, blockId: 1, wallId: 4, size: 1 });
    history.move(2, 2);
    expect(history.commit()).toEqual([]);
    expect(world.tileAt(2, 2).block).toEqual({ kind: "vanilla", id: 0 });
    expect(() => { history.begin({ layer: BRUSH_LAYER.both, blockId: 21, wallId: 4, size: 1 }); }).toThrow(RangeError);
    expect(() => { history.begin({ layer: BRUSH_LAYER.both, blockId: 1, wallId: 87, size: 1 }); }).toThrow(RangeError);
  });
  it("clips the square footprint and preserves protected objects and non-target planes", () => {
    const world = createWorld(8, 8);
    world.setTile(1, 1, { block: { kind: "vanilla", id: 21 }, frameX: 18, frameY: 0, wires: 0, actuator: false });
    world.setTile(0, 0, { wall: { kind: "vanilla", id: 4 }, liquid: { kind: "water", amount: 180 }, wires: 3, actuator: true });
    const before = world.tileAt(0, 0);
    const history = createBrushHistory(world, (x, y) => x === 0 && y === 1);
    history.begin({ layer: "wall", id: 1, size: 3 });
    history.move(0, 0);
    const diff = history.commit();
    expect(diff.map(({ x, y }) => [x, y])).toEqual([[0, 0], [1, 0]]);
    expect(world.tileAt(0, 0)).toEqual({ ...before, wall: { kind: "vanilla", id: 1 } });
    expect(world.tileAt(1, 1).block).toEqual({ kind: "vanilla", id: 21 });
    expect(world.tileAt(0, 1).wall).toBeUndefined();
  });

  it("interpolates fast drags, deduplicates overlap, and restores every plane byte on undo", () => {
    const world = createWorld(12, 6);
    world.setTile(2, 2, { block: { kind: "vanilla", id: 0 }, paint: 7, shape: "half", wires: 9, actuator: false });
    const original = Object.values(world.planes).map((plane) => new Uint8Array(plane.buffer).slice());
    const history = createBrushHistory(world);
    history.begin({ layer: "block", id: 1, size: 1 });
    history.move(1, 2);
    history.move(10, 2);
    history.move(1, 2);
    const diff = history.commit();
    expect(diff).toHaveLength(10);
    expect(history.canUndo()).toBe(true);
    const painted = Object.values(world.planes).map((plane) => new Uint8Array(plane.buffer).slice());
    expect(history.undo()).toHaveLength(10);
    expect(Object.values(world.planes).map((plane) => new Uint8Array(plane.buffer))).toEqual(original);
    expect(history.redo()).toHaveLength(10);
    expect(Object.values(world.planes).map((plane) => new Uint8Array(plane.buffer))).toEqual(painted);
  });

  it("erases only its layer, cancels strokes, and drops redo only after an effective new stroke", () => {
    const world = createWorld(6, 6);
    world.setTile(3, 3, { block: { kind: "vanilla", id: 30 }, wall: { kind: "vanilla", id: 4 }, wires: 2, actuator: false });
    const history = createBrushHistory(world);
    history.begin({ layer: "block", id: null, size: 1 });
    history.move(3, 3);
    history.commit();
    expect(world.tileAt(3, 3)).toEqual({ wall: { kind: "vanilla", id: 4 }, wires: 2, actuator: false });
    history.undo();
    history.begin({ layer: "wall", id: 1, size: 1 });
    history.move(3, 3);
    history.cancel();
    expect(world.tileAt(3, 3).wall).toEqual({ kind: "vanilla", id: 4 });
    expect(history.canRedo()).toBe(true);
    history.begin({ layer: "block", id: 30, size: 1 });
    history.move(3, 3);
    expect(history.commit()).toEqual([]);
    expect(history.canRedo()).toBe(true);
    history.begin({ layer: "wall", id: 5, size: 1 });
    history.move(3, 3);
    history.commit();
    expect(history.canRedo()).toBe(false);
  });

  it("rejects invalid sizes/content and leaves unknown content untouched", () => {
    const world = createWorld(4, 4);
    world.setTile(1, 1, { block: { kind: "unknown", runtimeId: 900 }, wires: 0, actuator: false });
    const history = createBrushHistory(world);
    expect(() => { history.begin({ layer: "block", id: 21, size: 1 }); }).toThrow(RangeError);
    for (const size of [0, 10, 1.5, NaN]) expect(() => { history.begin({ layer: "wall", id: 1, size }); }).toThrow(RangeError);
    history.begin({ layer: "block", id: 38, size: 9 });
    history.move(1, 1);
    history.commit();
    expect(world.tileAt(1, 1).block).toEqual({ kind: "unknown", runtimeId: 900 });
  });
});
