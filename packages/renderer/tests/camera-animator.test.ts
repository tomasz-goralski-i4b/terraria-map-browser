import { expect, test } from "vitest";
import { CameraAnimator, wheelPixels } from "../src/camera/animator.js";
import { MAX_ZOOM, clampCamera, fitWorld, screenToTile, tileToScreen } from "../src/camera/camera.js";
import type { Camera, Size } from "../src/camera/camera.js";

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

test.each([1, 4])("a drag followed by a no-op zoom factor %s keeps the pending pan", (factor) => {
  const { animator, advance } = motion({ ...initial, zoom: MAX_ZOOM });
  animator.beginDrag();
  animator.drag(-32, 16);
  animator.zoom(factor, 400, 300);
  expect(advance(16)).toEqual({
    camera: { x: initial.x + 32 / MAX_ZOOM, y: initial.y - 16 / MAX_ZOOM, zoom: MAX_ZOOM }, settled: true,
  });
  expect(animator.current).toEqual(animator.target);
});

test("held-key pan during eased zoom preserves the zoom target until settled", () => {
  const { animator, advance } = motion();
  animator.zoom(2, 400, 300);
  advance(40);
  animator.keyPan(-0.384, 0);
  advance(100);
  expect(animator.target.zoom).toBe(2);
  expect(animator.current.zoom).toBeGreaterThan(1);
  expect(animator.current.zoom).toBeLessThan(2);
  animator.keyPan(0, 0);
  expect(advance(2000)).toEqual({ camera: animator.target, settled: true });
  expect(animator.current.zoom).toBe(2);
});

/**
 * Milliseconds between the 162 wheel events of the Chrome trace behind #231 (CMCR1, a mouse wheel turned in and out
 * irregularly): p10 33 ms, p50 83 ms, p90 250 ms.
 */
const TRACE_GAPS = [
  51.2, 183.3, 133.2, 233.2, 600.4, 166.3, 99.9, 150.1, 100.1, 66.5, 83.4, 170.8, 112.8, 66.5, 66.5, 33.4, 83.4, 50,
  66.6, 16.8, 16.8, 266.5, 83.7, 83.2, 55.3, 44.9, 83.6, 832.9, 66.2, 133.3, 116.7, 166.6, 33.3, 16.7, 50.1, 66.7,
  33.2, 100, 250.1, 16.6, 350, 83.3, 133.4, 66.6, 67, 149.8, 83.3, 83.3, 1133.3, 50, 33.4, 83.4, 100, 66.6, 100.1,
  283.3, 117, 83.2, 66.5, 100, 100, 66.7, 83.4, 266.7, 50.2, 49.8, 50, 49.8, 100.1, 100, 116.7, 66.6, 416.8, 50,
  416.6, 183.4, 116.7, 83.3, 100, 100.1, 116.7, 350, 33.3, 100, 183.3, 116.8, 83.2, 66.7, 133.4, 83.3, 116.8, 49.9,
  283.3, 66.8, 216.8, 83, 166.7, 116.8, 133.3, 66.8, 49.9, 300, 49.9, 83.4, 66.7, 66.9, 83.4, 66.5, 83.3, 133.4,
  16.5, 666.7, 33.4, 249.9, 133.3, 33.4, 50, 150.1, 467, 33.4, 83.1, 83.2, 50.2, 83.4, 83.1, 100.1, 400.1, 33.1,
  33.3, 50, 83.5, 83.3, 66.7, 66.5, 66.7, 66.7, 100, 216.7, 33.2, 50, 33.4, 50, 50, 49.9, 33.3, 50.1, 83.4, 400,
  33.5, 83.2, 66.6, 50, 50.1, 133.3, 16.6, 16.8, 33.2, 50, 50.1, 33.2, 66.7,
];
/** One wheel notch (100 px at the map's 0.0015 per pixel) in log-zoom. */
const NOTCH = 0.15;
const FRAME_MS = 1000 / 60;

interface Notch { readonly time: number; readonly factor: number }

/** The trace's notches; the direction flips after every pause longer than 300 ms, so the zoom stays in range. */
function traceNotches(): Notch[] {
  const notches: Notch[] = [{ time: 0, factor: Math.exp(NOTCH) }];
  let time = 0;
  let direction = 1;
  for (const gap of TRACE_GAPS) {
    time += gap;
    if (gap > 300) direction = -direction;
    notches.push({ time, factor: Math.exp(direction * NOTCH) });
  }
  return notches;
}

interface ReplayFrame { readonly time: number; readonly camera: Camera; readonly target: Camera; readonly settled: boolean }

/** Wheel notches at a still cursor, delivered at their own times and drawn by 60 Hz frames until `until` ms. */
function replay(camera: Camera, size: Size, bounds: Size, cursor: { x: number; y: number }, notches: readonly Notch[], until: number) {
  let time = 0;
  const animator = new CameraAnimator(camera, size, bounds, () => time);
  const frames: ReplayFrame[] = [];
  let next = 0;
  for (let frame = 1; frame * FRAME_MS <= until; frame++) {
    const at = frame * FRAME_MS;
    for (let notch = notches[next]; notch !== undefined && notch.time <= at; notch = notches[++next]) {
      time = notch.time;
      animator.zoom(notch.factor, cursor.x, cursor.y);
    }
    time = at;
    const { camera: drawn, settled } = animator.step();
    frames.push({ time, camera: drawn, target: animator.target, settled });
  }
  return { animator, frames };
}

test("replayed irregular wheel input zooms smoothly, keeps up with the wheel and settles soon after it", () => {
  const notches = traceNotches();
  const last = notches.at(-1)?.time ?? 0;
  const bounds = { width: 100_000, height: 100_000 };
  const start: Camera = { x: 50_000, y: 50_000, zoom: 2 };
  const cursor = { x: 300, y: 200 };
  const { frames } = replay(start, viewport, bounds, cursor, notches, last + 400);
  const tile = screenToTile(start, cursor.x, cursor.y);
  const speeds: number[] = [];
  let previous = start.zoom;
  let lag = 0;
  let during = 0;
  for (const { time, camera, target } of frames) {
    speeds.push(Math.log(camera.zoom / previous));
    previous = camera.zoom;
    if (time <= last) {
      lag += Math.abs(Math.log(target.zoom / camera.zoom)) / NOTCH;
      during++;
    }
    // The tile under the still cursor stays under it through every notch.
    const under = screenToTile(camera, cursor.x, cursor.y);
    expect(under.x).toBeCloseTo(tile.x, 6);
    expect(under.y).toBeCloseTo(tile.y, 6);
  }
  let jerk = 0;
  for (let frame = 1; frame < speeds.length; frame++) jerk += Math.abs((speeds[frame] ?? 0) - (speeds[frame - 1] ?? 0));
  const end = frames.at(-1);
  // Mean frame-to-frame change of the zoom speed (the old per-notch glide: 0.0118).
  expect(jerk / (speeds.length - 1)).toBeLessThanOrEqual(0.003);
  expect(Math.max(...speeds.map((speed) => Math.exp(Math.abs(speed)) - 1))).toBeLessThanOrEqual(0.1);
  expect(lag / during).toBeLessThanOrEqual(1);
  // Within 400 ms of the last notch the zoom is within 0.1 % of the target.
  expect(Math.abs(Math.log((end?.camera.zoom ?? 0) / (end?.target.zoom ?? 1)))).toBeLessThanOrEqual(1e-3);
});

test("a glide arrives at the target exactly and stops requesting frames", () => {
  const notches = traceNotches().slice(0, 5);
  const { animator, frames } = replay(initial, viewport, world, { x: 300, y: 200 }, notches, 2000);
  expect(frames.at(-1)?.settled).toBe(true);
  expect(animator.current).toEqual(animator.target);
});

test("a notch from rest starts the zoom gently instead of jumping", () => {
  const { animator, advance } = motion();
  animator.zoom(Math.exp(NOTCH), 400, 300);
  const first = Math.log(advance(FRAME_MS).camera.zoom / initial.zoom);
  const second = Math.log(advance(FRAME_MS).camera.zoom / initial.zoom);
  const third = Math.log(advance(FRAME_MS).camera.zoom / initial.zoom) - second;
  expect(first).toBeGreaterThan(0);
  // The speed builds up over the first frames (the glide has a velocity) instead of peaking in the first one.
  expect(third).toBeGreaterThan(first);
});

test("an idle animator does not count the time before a notch as glide time", () => {
  const { animator, advance, elapse } = motion();
  elapse(5000);
  animator.zoom(Math.exp(NOTCH), 400, 300);
  const step = advance(FRAME_MS);
  expect(step.settled).toBe(false);
  expect(Math.log(step.camera.zoom / initial.zoom)).toBeLessThan(NOTCH / 4);
});

test("dragging during a glide stops the zoom where it is drawn, without a leftover velocity", () => {
  const { animator, advance } = motion();
  animator.zoom(4, 400, 300);
  advance(50);
  animator.beginDrag();
  animator.drag(-10, 0);
  const dragged = advance(16);
  expect(dragged.settled).toBe(true);
  expect(advance(100).camera).toEqual(dragged.camera);
});

test("wheel and pinch stay at the 64 px per tile limit without overshooting it", () => {
  const near: Camera = { ...initial, zoom: 48 };
  const cursor = { x: 123, y: 456 };
  const tile = screenToTile(near, cursor.x, cursor.y);
  const burst = Array.from({ length: 12 }, (_, notch) => ({ time: notch * 20, factor: Math.exp(NOTCH) }));
  const { animator, frames } = replay(near, viewport, world, cursor, burst, 1500);
  let previous = near.zoom;
  for (const { camera } of frames) {
    expect(camera.zoom).toBeLessThanOrEqual(MAX_ZOOM);
    expect(camera.zoom).toBeGreaterThanOrEqual(previous);
    previous = camera.zoom;
    const under = screenToTile(camera, cursor.x, cursor.y);
    expect(under.x).toBeCloseTo(tile.x, 6);
    expect(under.y).toBeCloseTo(tile.y, 6);
  }
  expect(frames.at(-1)?.settled).toBe(true);
  expect(animator.current.zoom).toBe(MAX_ZOOM);
  const resting = animator.current;
  animator.zoom(Math.exp(NOTCH), cursor.x, cursor.y);
  expect(animator.step()).toEqual({ camera: resting, settled: true });
  animator.zoom(1.5, cursor.x, cursor.y, true);
  expect(animator.step()).toEqual({ camera: resting, settled: true });
});

test("zooming in from fit-world moves the camera continuously when the world outgrows the viewport", () => {
  const size = { width: 3385, height: 1041 };
  const bounds = { width: 16400, height: 4800 };
  const fitted = fitWorld(size, bounds);
  // At fit-world the world is shorter than the viewport; the first notches make it fill the viewport vertically.
  expect(bounds.height * fitted.zoom).toBeLessThan(size.height);
  const notches = traceNotches().slice(5, 28).map((notch) => ({ time: notch.time - 1000, factor: Math.exp(NOTCH) }));
  for (const cursor of [{ x: 3000, y: 150 }, { x: 200, y: 1000 }, { x: 1692, y: 520 }]) {
    const { frames } = replay(fitted, size, bounds, cursor, notches, 3500);
    let before = fitted;
    for (const { camera } of frames) {
      // A zoom by factor f moves no point of the viewport further than its size × |f − 1|; more is a jump.
      const tile = screenToTile(before, cursor.x, cursor.y);
      const moved = tileToScreen(camera, tile.x, tile.y);
      const allowed = Math.max(size.width, size.height) * Math.abs(camera.zoom / before.zoom - 1) + 1e-6;
      expect(Math.hypot(moved.x - cursor.x, moved.y - cursor.y)).toBeLessThanOrEqual(allowed);
      before = camera;
    }
    expect(before.zoom).toBeGreaterThan(size.height / bounds.height);
  }
});
