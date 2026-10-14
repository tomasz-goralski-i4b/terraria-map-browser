export interface FrameObservation {
  readonly mode: "overview" | "chunks" | "sprites";
  readonly zoom: number;
  readonly uploads: number;
  readonly residentChunks: number;
}
export interface PerformanceSummary extends FrameObservation {
  readonly fps: number;
  readonly p50: number;
  readonly p95: number;
  readonly maxFrame: number;
}
export class FrameMetrics {
  private readonly capacity: number;
  constructor(capacity = 120) { this.capacity = capacity; }
  private previous: number | null = null;
  private intervals: number[] = [];
  private frame: FrameObservation = EMPTY;
  record(time: number, frame: FrameObservation): void {
    this.frame = frame;
    if (this.previous !== null && time > this.previous) {
      this.intervals.push(time - this.previous);
      if (this.intervals.length > this.capacity) this.intervals.shift();
    }
    this.previous = time;
  }
  summary(): PerformanceSummary {
    const sorted = [...this.intervals].sort((a, b) => a - b);
    const percentile = (fraction: number): number => sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] ?? 0;
    const total = this.intervals.reduce((sum, interval) => sum + interval, 0);
    return { ...this.frame, fps: total === 0 ? 0 : 1000 * sorted.length / total, p50: percentile(0.5), p95: percentile(0.95), maxFrame: sorted.at(-1) ?? 0 };
  }
  reset(): void { this.previous = null; this.intervals = []; this.frame = EMPTY; }
}
export interface BenchmarkRow extends PerformanceSummary { readonly step: number }
export interface StudioBenchmark { run(options: { readonly steps: number; readonly panMs: number }): Promise<readonly BenchmarkRow[]> }
declare global { interface Window { __studioBench?: StudioBenchmark } }

const EMPTY: PerformanceSummary = { mode: "overview", zoom: 0, uploads: 0, residentChunks: 0, fps: 0, p50: 0, p95: 0, maxFrame: 0 };
export const usePerformanceStore = create<{ readonly summary: PerformanceSummary }>()(() => ({ summary: EMPTY }));

interface BenchmarkDriver {
  readonly fit: () => void;
  readonly settled: () => boolean;
}

/** One display-frame sampler shared by the overlay and scripted input. No React work per frame. */
export function installPerformance(canvas: HTMLCanvasElement, driver: BenchmarkDriver): {
  readonly onFrame: (frame: FrameObservation) => void;
  readonly dispose: () => void;
} {
  const overlay = new URLSearchParams(location.search).has("perf");
  const rolling = new FrameMetrics();
  const measured = new FrameMetrics(Infinity);
  let latest: FrameObservation = EMPTY;
  let uploads = 0, stepUploads = 0;
  let sampling: number | null = null;
  let published = 0;
  let running = false, disposed = false;
  const pending = new Map<number, (reason: Error) => void>();

  const sample = (time: number): void => {
    sampling = null;
    if (disposed || (!overlay && !running)) return;
    const frame = { ...latest, uploads };
    uploads = 0;
    rolling.record(time, frame);
    if (running) measured.record(time, frame);
    if (overlay && time - published >= 250) {
      published = time;
      usePerformanceStore.setState({ summary: rolling.summary() });
    }
    sampling = requestAnimationFrame(sample);
  };
  const startSampling = (): void => {
    if (sampling === null && !disposed) { rolling.reset(); sampling = requestAnimationFrame(sample); }
  };
  const nextFrame = (): Promise<number> => new Promise((resolve, reject) => {
    if (disposed) { reject(new Error("Map closed during benchmark.")); return; }
    const id = requestAnimationFrame((time) => { pending.delete(id); resolve(time); });
    pending.set(id, reject);
  });
  const waitForZoom = async (): Promise<void> => {
    const start = performance.now();
    while (!driver.settled()) {
      if (performance.now() - start > 5000) throw new Error("Camera did not settle during benchmark.");
      await nextFrame();
    }
  };
  const pointer = (type: string, x: number, y: number): void => {
    canvas.dispatchEvent(new PointerEvent(type, { bubbles: true, pointerId: 218, pointerType: "mouse", button: 1, buttons: type === "pointercancel" ? 0 : 4, clientX: x, clientY: y }));
  };
  const benchmark: StudioBenchmark = {
    run: async ({ steps, panMs }) => {
      if (!Number.isInteger(steps) || steps < 1 || steps > 100) throw new Error("steps must be an integer from 1 to 100.");
      if (!Number.isFinite(panMs) || panMs < 50 || panMs > 60000) throw new Error("panMs must be between 50 and 60000 milliseconds.");
      if (disposed) throw new Error("Map closed before benchmark.");
      if (running) throw new Error("A benchmark is already running.");
      running = true;
      startSampling();
      const rows: BenchmarkRow[] = [];
      let dragging = false;
      let x = 0, y = 0;
      try {
        driver.fit();
        await nextFrame();
        for (let step = 1; step <= steps; step++) {
          measured.reset(); stepUploads = 0;
          const rect = canvas.getBoundingClientRect();
          x = rect.left + rect.width / 2; y = rect.top + rect.height / 2;
          canvas.dispatchEvent(new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY: -120, clientX: x, clientY: y }));
          await waitForZoom();
          pointer("pointerdown", x, y); dragging = true;
          const start = await nextFrame();
          let time = start;
          while (time - start < panMs) {
            const distance = Math.min(time - start, panMs) * 0.384 * (step % 2 === 1 ? 1 : -1);
            pointer("pointermove", x + distance, y);
            time = await nextFrame();
          }
          pointer("pointercancel", x, y); dragging = false;
          await nextFrame();
          rows.push({ ...measured.summary(), ...latest, uploads: stepUploads, step });
        }
        return rows;
      } finally {
        if (dragging) pointer("pointercancel", x, y);
        running = false;
        if (!overlay && sampling !== null) { cancelAnimationFrame(sampling); sampling = null; }
      }
    },
  };
  if (import.meta.env.DEV) window.__studioBench = benchmark;
  if (overlay) startSampling();
  return {
    onFrame: (frame) => {
      latest = frame;
      if (overlay || running) uploads += frame.uploads;
      if (running) stepUploads += frame.uploads;
    },
    dispose: () => {
      disposed = true;
      if (sampling !== null) cancelAnimationFrame(sampling);
      for (const [id, reject] of pending) { cancelAnimationFrame(id); reject(new Error("Map closed during benchmark.")); }
      pending.clear();
      if (window.__studioBench === benchmark) delete window.__studioBench;
      usePerformanceStore.setState({ summary: EMPTY });
    },
  };
}
import { create } from "zustand";
