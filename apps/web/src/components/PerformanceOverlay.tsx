import { usePerformanceStore } from "../performance.js";

export function PerformanceOverlay(): React.JSX.Element | null {
  const { fps, p50, p95, uploads, residentChunks, mode, zoom } = usePerformanceStore((state) => state.summary);
  if (!new URLSearchParams(location.search).has("perf")) return null;
  return <output className="performance-overlay" aria-label="Viewer performance">
    {fps.toFixed(1)} FPS · p50 {p50.toFixed(1)} ms · p95 {p95.toFixed(1)} ms<br />
    {uploads} chunk uploads/frame · {residentChunks} resident chunks<br />
    {mode} · {zoom.toFixed(3)} px/tile
  </output>;
}
