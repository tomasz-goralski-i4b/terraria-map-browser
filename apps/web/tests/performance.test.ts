import { expect, test } from "vitest";
import { FrameMetrics } from "../src/performance.js";

test("frame metrics use elapsed frame intervals and nearest-rank percentiles with actual renderer figures", () => {
  const metrics = new FrameMetrics();
  const frame = { mode: "sprites", zoom: 16, uploads: 2, residentChunks: 8 } as const;
  let time = 100;
  metrics.record(time, frame);
  for (const interval of [10, 20, 30, 40, 50]) { time += interval; metrics.record(time, frame); }
  expect(metrics.summary()).toEqual({ ...frame, fps: 1000 / 30, p50: 30, p95: 50, maxFrame: 50 });
  metrics.reset();
  expect(metrics.summary()).toMatchObject({ fps: 0, p50: 0, p95: 0, maxFrame: 0 });
});

test("the rolling window is bounded and ignores duplicate timestamps", () => {
  const metrics = new FrameMetrics();
  const frame = { mode: "overview", zoom: 0.1, uploads: 0, residentChunks: 4 } as const;
  metrics.record(0, frame);
  metrics.record(1000, frame);
  metrics.record(1000, frame);
  for (let index = 1; index <= 121; index++) metrics.record(1000 + index * 10, frame);
  expect(metrics.summary()).toMatchObject({ fps: 100, p50: 10, p95: 10, maxFrame: 10 });
});
