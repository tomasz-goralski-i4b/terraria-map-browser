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
  record(_time: number, _frame: FrameObservation): void { throw new Error("not implemented"); }
  summary(): PerformanceSummary { throw new Error("not implemented"); }
  reset(): void { throw new Error("not implemented"); }
}
export interface BenchmarkRow extends PerformanceSummary { readonly step: number }
export interface StudioBenchmark { run(options: { readonly steps: number; readonly panMs: number }): Promise<readonly BenchmarkRow[]> }
declare global { interface Window { __studioBench?: StudioBenchmark } }
