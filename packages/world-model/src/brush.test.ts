import { describe, expect, it } from "vitest";
import { createWorld } from "./index.js";
import { BRUSH_SIZE, createBrushHistory, type BrushOptions } from "./brush.js";

const place = (id: number, paint = 0) => ({ kind: "place", id, paint }) as const;
const ERASE = { kind: "erase" } as const;
const planeBytes = (world: ReturnType<typeof createWorld>): Uint8Array[] =>
  Object.values(world.planes).map((plane) => new Uint8Array(plane.buffer).slice());

function stroke(history: ReturnType<typeof createBrushHistory>, options: BrushOptions, ...points: (readonly [number, number])[]) {
  history.begin(options);
  for (const [x, y] of points) history.move(x, y);
  return history.commit();
}

describe("brush", () => {
  it("rasterizes a three-tile round brush as a plus, shared by place and erase", () => {
    const world = createWorld(9, 9);
    const history = createBrushHistory(world);
    expect(stroke(history, { block: place(1), size: 3, shape: "circle" }, [4, 4]).map(({ x, y }) => [x, y]))
      .toEqual([[3, 4], [4, 3], [4, 4], [4, 5], [5, 4]]);
    expect(stroke(history, { block: ERASE, size: 3, shape: "circle" }, [4, 4])).toHaveLength(5);
    expect(world.tileAt(4, 4).block).toBeUndefined();
    history.undo();
    expect(world.tileAt(4, 4).block).toEqual({ kind: "vanilla", id: 1 });
  });

  it("erases liquids and wires with actuators on their own, leaving blocks and walls, and undoes them", () => {
    const world = createWorld(5, 5);
    world.setTile(2, 2, { block: { kind: "vanilla", id: 1 }, wall: { kind: "vanilla", id: 4 }, wires: 0b1011, actuator: true, liquid: { kind: "water", amount: 200 } });
    const history = createBrushHistory(world);
    expect(stroke(history, { wires: "erase", size: 1 }, [2, 2])).toHaveLength(1);
    expect(world.tileAt(2, 2)).toMatchObject({ block: { id: 1 }, wall: { id: 4 }, wires: 0, actuator: false, liquid: { kind: "water", amount: 200 } });
    stroke(history, { liquid: "erase", size: 1 }, [2, 2]);
    expect(world.tileAt(2, 2).liquid).toBeUndefined();
    expect(world.tileAt(2, 2).block).toEqual({ kind: "vanilla", id: 1 });
    history.undo(); history.undo();
    expect(world.tileAt(2, 2)).toMatchObject({ wires: 0b1011, actuator: true, liquid: { kind: "water", amount: 200 } });
    expect(() => { history.begin({ size: 1 }); }).toThrow(RangeError);
  });

  it("uses a circular tile mask with exact history and edge clipping", () => {
    const world = createWorld(9, 9);
    const history = createBrushHistory(world);
    expect(stroke(history, { block: place(1), wall: place(4), size: 5, shape: "circle" }, [4, 4])).toHaveLength(21);
    expect(world.tileAt(2, 2).block).toBeUndefined();
    expect(world.tileAt(2, 4).block).toEqual({ kind: "vanilla", id: 1 });
    expect(stroke(history, { block: ERASE, wall: ERASE, size: 5, shape: "circle" }, [4, 4])).toHaveLength(21);
    history.undo();
    expect(world.tileAt(4, 4).wall).toEqual({ kind: "vanilla", id: 4 });
    history.undo();
    expect(stroke(history, { block: place(38), size: 5, shape: "circle" }, [0, 0])).toHaveLength(8);
  });

  it("edits both layers as one atomic stroke and one byte-exact undo entry, keeping wires and actuators", () => {
    const world = createWorld(5, 5);
    world.setTile(2, 2, { block: { kind: "vanilla", id: 0 }, wall: { kind: "vanilla", id: 2 }, wires: 9, actuator: true });
    const original = planeBytes(world);
    const history = createBrushHistory(world);
    expect(stroke(history, { block: place(1), wall: place(4), size: 1 }, [2, 2])).toHaveLength(1);
    expect(world.tileAt(2, 2)).toEqual({ block: { kind: "vanilla", id: 1 }, wall: { kind: "vanilla", id: 4 }, wires: 9, actuator: true });
    history.undo();
    expect(planeBytes(world)).toEqual(original);
    history.redo();
    stroke(history, { block: ERASE, wall: ERASE, size: 1 }, [2, 2]);
    expect(world.tileAt(2, 2)).toEqual({ wires: 9, actuator: true });
  });

  it("places a block as newly placed content: full, unframed, unpainted unless chosen, active, uncoated and dry", () => {
    const world = createWorld(3, 3);
    world.setTile(1, 1, {
      block: { kind: "vanilla", id: 0 }, frameX: 18, frameY: 36, paint: 7, shape: "slopeTopLeft", inactive: true,
      invisibleBlock: true, fullBrightBlock: true, liquid: { kind: "water", amount: 255 },
      wall: { kind: "vanilla", id: 2 }, wallPaint: 3, wires: 5, actuator: true,
    });
    const history = createBrushHistory(world);
    stroke(history, { block: place(1, 12), size: 1 }, [1, 1]);
    expect(world.tileAt(1, 1)).toEqual({
      block: { kind: "vanilla", id: 1 }, paint: 12, wall: { kind: "vanilla", id: 2 }, wallPaint: 3, wires: 5, actuator: true,
    });
  });

  it("over the same content only changes its paint, keeping its shape and coatings", () => {
    const world = createWorld(3, 3);
    world.setTile(1, 1, { block: { kind: "vanilla", id: 1 }, shape: "half", fullBrightBlock: true, wall: { kind: "vanilla", id: 4 }, invisibleWall: true, wires: 0, actuator: false });
    const history = createBrushHistory(world);
    expect(stroke(history, { block: place(1), wall: place(4), size: 1 }, [1, 1])).toEqual([]);
    stroke(history, { block: place(1, 25), wall: place(4, 26), size: 1 }, [1, 1]);
    expect(world.tileAt(1, 1)).toEqual({
      block: { kind: "vanilla", id: 1 }, paint: 25, shape: "half", fullBrightBlock: true,
      wall: { kind: "vanilla", id: 4 }, wallPaint: 26, invisibleWall: true, wires: 0, actuator: false,
    });
  });

  it("places a wall with its own paint and no coating from the wall it replaces", () => {
    const world = createWorld(3, 3);
    world.setTile(1, 1, { wall: { kind: "vanilla", id: 2 }, wallPaint: 9, invisibleWall: true, fullBrightWall: true, wires: 0, actuator: false });
    const history = createBrushHistory(world);
    stroke(history, { wall: place(16, 4), size: 1 }, [1, 1]);
    expect(world.tileAt(1, 1)).toEqual({ wall: { kind: "vanilla", id: 16 }, wallPaint: 4, wires: 0, actuator: false });
  });

  it("paints only existing content in paint mode, and paint 0 removes the paint", () => {
    const world = createWorld(4, 1);
    world.setTile(0, 0, { block: { kind: "vanilla", id: 1 }, wires: 0, actuator: false });
    world.setTile(1, 0, { wall: { kind: "vanilla", id: 4 }, wires: 0, actuator: false });
    world.setTile(2, 0, { block: { kind: "vanilla", id: 1 }, paint: 3, wires: 0, actuator: false });
    const history = createBrushHistory(world);
    expect(stroke(history, { block: { kind: "paint", paint: 8 }, size: 1 }, [0, 0], [3, 0]).map(({ x }) => x)).toEqual([0, 2]);
    expect(world.tileAt(0, 0).paint).toBe(8);
    expect(world.tileAt(1, 0).block).toBeUndefined();
    expect(world.tileAt(1, 0).wallPaint).toBeUndefined();
    stroke(history, { block: { kind: "paint", paint: 0 }, wall: { kind: "paint", paint: 5 }, size: 1 }, [0, 0], [3, 0]);
    expect(world.tileAt(0, 0).paint).toBeUndefined();
    expect(world.tileAt(1, 0).wallPaint).toBe(5);
  });

  it("erasing a block takes its paint, shape and coatings but keeps the wall, liquid and wiring", () => {
    const world = createWorld(3, 3);
    world.setTile(1, 1, {
      block: { kind: "vanilla", id: 30 }, paint: 2, shape: "half", invisibleBlock: true, fullBrightBlock: true,
      wall: { kind: "vanilla", id: 4 }, wires: 2, actuator: true,
    });
    const history = createBrushHistory(world);
    stroke(history, { block: ERASE, size: 1 }, [1, 1]);
    expect(world.tileAt(1, 1)).toEqual({ wall: { kind: "vanilla", id: 4 }, wires: 2, actuator: true });
  });

  it("asks the rules per layer: Both skips a tile atomically when either layer is protected", () => {
    const world = createWorld(5, 1);
    for (let x = 0; x < 5; x++) world.setTile(x, 0, { block: { kind: "vanilla", id: 0 }, wall: { kind: "vanilla", id: 2 }, wires: 0, actuator: false });
    const history = createBrushHistory(world, { protectedTile: (x, _y, layer) => (x === 1 && layer === "wall") || (x === 3 && layer === "block") });
    expect(stroke(history, { block: place(1), wall: place(4), size: 1 }, [0, 0], [4, 0]).map(({ x }) => x)).toEqual([0, 2, 4]);
    expect(stroke(history, { wall: place(5), size: 1 }, [0, 0], [4, 0]).map(({ x }) => x)).toEqual([0, 2, 3, 4]);
    expect(stroke(history, { block: ERASE, size: 1 }, [0, 0], [4, 0]).map(({ x }) => x)).toEqual([0, 1, 2, 4]);
  });

  it("interpolates fast drags, deduplicates overlap, and restores every plane byte on undo", () => {
    const world = createWorld(12, 6);
    world.setTile(2, 2, { block: { kind: "vanilla", id: 0 }, paint: 7, shape: "half", wires: 9, actuator: false });
    const original = planeBytes(world);
    const history = createBrushHistory(world);
    expect(stroke(history, { block: place(1), size: 1 }, [1, 2], [10, 2], [1, 2])).toHaveLength(10);
    const painted = planeBytes(world);
    expect(history.undo()).toHaveLength(10);
    expect(planeBytes(world)).toEqual(original);
    expect(history.redo()).toHaveLength(10);
    expect(planeBytes(world)).toEqual(painted);
  });

  it("covers exactly the union of whole footprints along a winding, fast stroke", () => {
    for (const shape of ["square", "circle"] as const) {
      const world = createWorld(60, 50);
      const history = createBrushHistory(world);
      const points = [[10, 10], [11, 11], [30, 14], [25, 40], [26, 39], [50, 20], [49, 20], [5, 45]] as const;
      const changed = stroke(history, { block: place(1), size: 7, shape }, ...points);
      const expected = new Set<string>();
      for (let i = 0; i < points.length; i++) {
        const [x1, y1] = points[i] ?? [0, 0];
        const [x0, y0] = points[i - 1] ?? [x1, y1];
        const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
        for (let step = 0; step <= steps; step++) {
          const cx = Math.round(x0 + (x1 - x0) * step / steps);
          const cy = Math.round(y0 + (y1 - y0) * step / steps);
          for (let x = 0; x < 60; x++) for (let y = 0; y < 50; y++) {
            const inSquare = Math.abs(x - cx + 0.5) <= 3.5 && Math.abs(y - cy + 0.5) <= 3.5;
            const inCircle = Math.hypot(x - cx, y - cy) <= 3.25;
            if (shape === "square" ? inSquare && x - cx >= -3 && x - cx <= 3 && y - cy >= -3 && y - cy <= 3 : inCircle) expected.add(`${String(x)},${String(y)}`);
          }
        }
      }
      expect(new Set(changed.map(({ x, y }) => `${String(x)},${String(y)}`)), shape).toEqual(expected);
    }
  });

  it("cancels strokes, and drops redo only after an effective new stroke", () => {
    const world = createWorld(6, 6);
    world.setTile(3, 3, { block: { kind: "vanilla", id: 30 }, wall: { kind: "vanilla", id: 4 }, wires: 2, actuator: false });
    const history = createBrushHistory(world);
    stroke(history, { block: ERASE, size: 1 }, [3, 3]);
    history.undo();
    history.begin({ wall: place(1), size: 1 });
    history.move(3, 3);
    history.cancel();
    expect(world.tileAt(3, 3).wall).toEqual({ kind: "vanilla", id: 4 });
    expect(history.canRedo()).toBe(true);
    expect(stroke(history, { block: place(30), size: 1 }, [3, 3])).toEqual([]);
    expect(history.canRedo()).toBe(true);
    stroke(history, { wall: place(5), size: 1 }, [3, 3]);
    expect(history.canRedo()).toBe(false);
  });

  it("accepts sizes up to the maximum and validates sizes, layers, content and paint before any change", () => {
    const world = createWorld(70, 70);
    const history = createBrushHistory(world, { placeable: (layer, id) => layer === "block" ? id !== 21 : id !== 87 });
    expect(stroke(history, { block: place(1), size: BRUSH_SIZE.maximum }, [35, 35])).toHaveLength(BRUSH_SIZE.maximum ** 2);
    for (const size of [0, BRUSH_SIZE.maximum + 1, 1.5, NaN]) expect(() => { history.begin({ wall: place(1), size }); }).toThrow(RangeError);
    expect(() => { history.begin({ size: 1 }); }).toThrow(RangeError);
    expect(() => { history.begin({ block: place(21), size: 1 }); }).toThrow(RangeError);
    expect(() => { history.begin({ block: place(1), wall: place(87), size: 1 }); }).toThrow(RangeError);
    expect(() => { history.begin({ wall: place(0), size: 1 }); }).toThrow(RangeError);
    expect(() => { history.begin({ block: place(1, 256), size: 1 }); }).toThrow(RangeError);
    expect(() => { history.begin({ block: { kind: "paint", paint: -1 }, size: 1 }); }).toThrow(RangeError);
    expect(history.canUndo()).toBe(true);
  });

  it("leaves unknown and mod content in the edited layer untouched", () => {
    const world = createWorld(4, 4);
    world.setTile(1, 1, { block: { kind: "unknown", runtimeId: 900 }, wires: 0, actuator: false });
    world.setTile(2, 2, { wall: { kind: "mod", mod: "Example", internalName: "Wall" }, wires: 0, actuator: false });
    const history = createBrushHistory(world);
    stroke(history, { block: place(38), wall: place(4), size: 4 }, [2, 2]);
    expect(world.tileAt(1, 1).block).toEqual({ kind: "unknown", runtimeId: 900 });
    expect(world.tileAt(2, 2).wall).toEqual({ kind: "mod", mod: "Example", internalName: "Wall" });
    stroke(history, { block: ERASE, size: 4 }, [2, 2]);
    expect(world.tileAt(1, 1).block).toEqual({ kind: "unknown", runtimeId: 900 });
    expect(world.tileAt(2, 2).wall).toEqual({ kind: "mod", mod: "Example", internalName: "Wall" });
  });
});
