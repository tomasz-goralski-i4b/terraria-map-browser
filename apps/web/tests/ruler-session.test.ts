import { beforeEach, expect, test } from "vitest";
import { beginMeasurement, moveMeasurement, finishMeasurement, setRulerWorld, useRulerStore, undoMeasurement, redoMeasurement, changeMeasurement } from "../src/world/ruler-session.js";

beforeEach(() => { setRulerWorld({ width: 4200, height: 1200, key: "workshop-layout" }, null); });

test("Shift previews a rectangle while held, and committed measurements support undo and redo", () => {
  beginMeasurement({ x: 120, y: 80 }, "line");
  moveMeasurement({ x: 130, y: 86 }, true);
  expect(useRulerStore.getState().draft?.kind).toBe("rectangle");
  moveMeasurement({ x: 130, y: 86 }, false);
  expect(useRulerStore.getState().draft?.kind).toBe("line");
  moveMeasurement({ x: 130, y: 86 }, true);
  finishMeasurement(true);
  expect(useRulerStore.getState().items).toHaveLength(1);
  expect(useRulerStore.getState().items[0]?.kind).toBe("rectangle");
  undoMeasurement();
  expect(useRulerStore.getState().items).toHaveLength(0);
  redoMeasurement();
  expect(useRulerStore.getState().items).toHaveLength(1);
});

test("replacement is undoable, cancelled and zero-size drafts never remove existing measurements", () => {
  beginMeasurement({ x: 120, y: 80 }, "line"); moveMeasurement({ x: 130, y: 80 }, false); finishMeasurement(true);
  beginMeasurement({ x: 140, y: 80 }, "line"); moveMeasurement({ x: 150, y: 80 }, false); finishMeasurement(false);
  expect(useRulerStore.getState().items).toHaveLength(1);
  expect(useRulerStore.getState().items[0]?.start.x).toBe(140);
  undoMeasurement();
  expect(useRulerStore.getState().items[0]?.start.x).toBe(120);
  beginMeasurement({ x: 160, y: 80 }, "line"); finishMeasurement(false, true);
  expect(useRulerStore.getState().items[0]?.start.x).toBe(120);
});

test("moving a measurement clamps the whole shape and edits preserve its identity", () => {
  beginMeasurement({ x: 4190, y: 1190 }, "rectangle"); moveMeasurement({ x: 4200, y: 1200 }, false); finishMeasurement(true);
  const original = useRulerStore.getState().items[0];
  if (original === undefined) throw new Error("Workshop measurement was not created");
  beginMeasurement({ x: 4195, y: 1195 }, "line", { id: original.id, part: "move" });
  moveMeasurement({ x: 5000, y: 1300 }, false); finishMeasurement(true);
  expect(useRulerStore.getState().items[0]).toEqual(original);
  changeMeasurement(original.id, { name: "Workshop", visible: false });
  expect(useRulerStore.getState().items[0]).toMatchObject({ name: "Workshop", visible: false });
});
