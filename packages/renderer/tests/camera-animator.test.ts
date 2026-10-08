import { expect, test } from "vitest";
import { CameraAnimator, wheelPixels } from "../src/camera/animator.js";
import { clampCamera, screenToTile } from "../src/camera/camera.js";
import type { Camera } from "../src/camera/camera.js";

const world = { width: 8400, height: 2400 };
const viewport = { width: 800, height: 600 };
const initial: Camera = { x: 3000, y: 900, zoom: 1 };

function motion(camera = initial) {
  let time = 0;
  const animator = new CameraAnimator(camera, viewport, world, () => time);
  return { animator, advance: (ms: number) => { time += ms; return animator.step(); }, elapse: (ms: number) => { time += ms; } };
}

test("zoom keeps the anchored cave tile fixed throughout easing and settles exactly", () => {
  const { animator, advance } = motion();
  const tile = screenToTile(initial, 123, 456);
  animator.zoom(4, 123, 456);
  expect(animator.current).toEqual(initial);
  let settled = false;
  for (let frame = 0; frame < 200; frame++) {
    const result = advance(16);
    const under = screenToTile(result.camera, 123, 456);
    expect(under.x).toBeCloseTo(tile.x, 6);
    expect(under.y).toBeCloseTo(tile.y, 6);
    settled = result.settled;
    if (settled) break;
  }
  expect(settled).toBe(true);
  expect(animator.current).toEqual(animator.target);
  expect(advance(16)).toEqual({ camera: animator.target, settled: true });
});

test("100 ms in one frame and ten 10 ms frames have the same camera", () => {
  const one = motion();
  const ten = motion();
  one.animator.zoom(4, 123, 456);
  ten.animator.zoom(4, 123, 456);
  one.advance(100);
  for (let frame = 0; frame < 10; frame++) ten.advance(10);
  expect(one.animator.current.x).toBeCloseTo(ten.animator.current.x, 9);
  expect(one.animator.current.y).toBeCloseTo(ten.animator.current.y, 9);
  expect(one.animator.current.zoom).toBeCloseTo(ten.animator.current.zoom, 9);
});

test("retargeting starts at the drawn camera and accumulates target zoom", () => {
  const { animator, advance } = motion();
  animator.zoom(2, 123, 456);
  advance(40);
  const drawn = animator.current;
  const anchor = screenToTile(drawn, 400, 300);
  animator.zoom(1.5, 400, 300);
  expect(animator.current).toEqual(drawn);
  expect(animator.target.zoom).toBe(3);
  const under = screenToTile(advance(30).camera, 400, 300);
  expect(under.x).toBeCloseTo(anchor.x, 6);
  expect(under.y).toBeCloseTo(anchor.y, 6);
});

test("wheel normalization handles pixels, Firefox lines and pages", () => {
  expect(wheelPixels(-3, 1, 600)).toBe(wheelPixels(-48, 0, 600));
  expect(wheelPixels(1, 2, 600)).toBe(wheelPixels(600, 0, 600));
});

function flick() {
  const run = motion();
  run.animator.beginDrag();
  run.elapse(20);
  run.animator.drag(-20, -10);
  run.elapse(20);
  run.animator.drag(-20, -10);
  run.animator.endDrag();
  return run;
}

test("a flick decays monotonically to zero and stops requesting frames", () => {
  const { animator, advance } = flick();
  expect(animator.velocity).toEqual({ x: -1, y: -0.5 });
  let previous = Math.hypot(animator.velocity.x, animator.velocity.y);
  let settled = false;
  for (let frame = 0; frame < 200; frame++) {
    const result = advance(16);
    const speed = Math.hypot(animator.velocity.x, animator.velocity.y);
    expect(speed).toBeLessThanOrEqual(previous);
    expect(result.camera).toEqual(clampCamera(result.camera, viewport, world));
    previous = speed;
    settled = result.settled;
    if (settled) break;
  }
  expect(settled).toBe(true);
  expect(animator.velocity).toEqual({ x: 0, y: 0 });
  expect(animator.current.x).toBeGreaterThan(initial.x + 40);
});

test("release uses only the recent 100 ms and a paused drag has no stale velocity", () => {
  const run = motion();
  run.animator.beginDrag();
  run.elapse(50);
  run.animator.drag(-200, 0);
  run.elapse(150);
  run.animator.drag(-10, 0);
  run.elapse(50);
  run.animator.drag(-20, 0);
  run.animator.endDrag();
  expect(run.animator.velocity.x).toBeCloseTo(-(10 * (50 / 150) + 20) / 100, 9);
  run.animator.beginDrag();
  run.elapse(20);
  run.animator.drag(-40, 0);
  run.elapse(150);
  run.animator.endDrag();
  expect(run.animator.velocity.x).toBe(0);
});

test("inertia clamps at world edges and stops there", () => {
  const run = motion({ x: 1, y: 1, zoom: 1 });
  run.animator.beginDrag();
  run.elapse(20);
  run.animator.drag(20, 20);
  run.animator.endDrag();
  const result = run.advance(100);
  expect(result.camera).toEqual({ x: 0, y: 0, zoom: 1 });
  expect(result.settled).toBe(true);
});

test.each(["pointer", "wheel", "key"])("%s input cancels kinetic pan", (input) => {
  const { animator } = flick();
  if (input === "pointer") animator.beginDrag();
  if (input === "wheel") animator.zoom(1.2, 400, 300);
  if (input === "key") animator.keyPan(-0.384, 0);
  expect(animator.velocity).toEqual({ x: 0, y: 0 });
});

test("held-key pan is time based and ends on release", () => {
  const { animator, advance } = motion();
  animator.keyPan(-0.384, 0);
  expect(advance(100).camera.x).toBeCloseTo(initial.x + 38.4, 9);
  expect(advance(100).camera.x).toBeCloseTo(initial.x + 76.8, 9);
  animator.keyPan(0, 0);
  const stopped = animator.current;
  expect(advance(100)).toEqual({ camera: stopped, settled: true });
});

test("reduced motion and direct pinch reach the target on the first frame", () => {
  for (const reduce of [false, true]) {
    const { animator, advance } = motion();
    animator.setReducedMotion(reduce);
    animator.zoom(2, 400, 300, !reduce);
    expect(animator.current).toEqual(initial);
    expect(advance(16)).toEqual({ camera: animator.target, settled: true });
  }
  const { animator, advance } = flick();
  animator.setReducedMotion(true);
  const result = advance(16);
  expect(result.settled).toBe(true);
  expect(animator.velocity).toEqual({ x: 0, y: 0 });
  expect(advance(100).camera).toEqual(result.camera);
});

test("reset cancels animation and uses the replacement world bounds", () => {
  const { animator, advance } = flick();
  animator.zoom(2, 400, 300);
  const replacement = { width: 1200, height: 600 };
  animator.reset({ x: 200, y: 0, zoom: 1 }, viewport, replacement);
  expect(advance(100)).toEqual({ camera: { x: 200, y: 0, zoom: 1 }, settled: true });
  animator.pan(-1000, 0);
  expect(advance(16).camera.x).toBe(400);
});
