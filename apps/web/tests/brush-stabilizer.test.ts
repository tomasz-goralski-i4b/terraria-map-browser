import { describe, expect, it } from "vitest";
import { createBrushStabilizer } from "../src/world/brush-stabilizer.js";

describe("brush stabilization", () => {
  it("keeps the first movement after a long stationary hold delayed", () => {
    const stroke = createBrushStabilizer({ x: 30, y: 40 }, 100);
    expect(stroke.step(16).settled).toBe(true);
    stroke.move({ x: 230, y: 40 }, 2000);
    const resumed = stroke.step(16);
    expect(resumed.point?.x).toBeGreaterThan(30);
    expect(resumed.point?.x).toBeLessThan(40);
    expect(resumed.settled).toBe(false);
  });
  it("trails continuous screen coordinates, settles while held, and flushes the release endpoint", () => {
    const stroke = createBrushStabilizer({ x: 20, y: 30 }, 50);
    stroke.move({ x: 120, y: 30 });
    const first = stroke.step(16);
    expect(first.point?.x).toBeGreaterThan(20);
    expect(first.point?.x).toBeLessThan(35);
    expect(first.settled).toBe(false);
    for (let frame = 0; frame < 150; frame++) stroke.step(16);
    expect(stroke.step(16)).toEqual({ point: { x: 120, y: 30 }, settled: true });
    stroke.move({ x: 160, y: 45 });
    expect(stroke.finish()).toEqual({ x: 160, y: 45 });
  });
  it("uses elapsed time rather than event frequency and breaks the path outside the world", () => {
    const longFrame = createBrushStabilizer({ x: 0, y: 0 }, 75);
    const shortFrames = createBrushStabilizer({ x: 0, y: 0 }, 75);
    longFrame.move({ x: 80, y: 40 });
    shortFrames.move({ x: 80, y: 40 });
    shortFrames.step(8);
    expect(shortFrames.step(8).point?.x).toBeCloseTo(longFrame.step(16).point?.x ?? 0);
    shortFrames.move(null);
    expect(shortFrames.step(16).point).toBeNull();
    shortFrames.move({ x: 140, y: 70 });
    expect(shortFrames.step(16)).toEqual({ point: { x: 140, y: 70 }, settled: true });
    const immediate = createBrushStabilizer({ x: 10, y: 10 }, 0);
    immediate.move({ x: 90, y: 25 });
    expect(immediate.step(1)).toEqual({ point: { x: 90, y: 25 }, settled: true });
  });
});
