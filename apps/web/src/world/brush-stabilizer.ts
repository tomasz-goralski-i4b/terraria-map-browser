export interface BrushPoint { readonly x: number; readonly y: number }
/** Screen-space trailing cursor, advanced by elapsed animation time before tile quantization. */
export function createBrushStabilizer(start: BrushPoint, strength: number): {
  move: (point: BrushPoint | null, elapsedMs?: number) => BrushPoint | null;
  step: (elapsedMs: number) => { readonly point: BrushPoint | null; readonly settled: boolean };
  finish: () => BrushPoint | null;
} {
  let target: BrushPoint | null = start;
  let current: BrushPoint | null = start;
  const step = (elapsedMs: number): { readonly point: BrushPoint | null; readonly settled: boolean } => {
    if (target === null || current === null) return { point: null, settled: true };
    const alpha = strength === 0 ? 1 : 1 - Math.exp(-Math.max(0, elapsedMs) / (strength * 4));
    current = { x: current.x + (target.x - current.x) * alpha, y: current.y + (target.y - current.y) * alpha };
    const settled = Math.hypot(target.x - current.x, target.y - current.y) < 0.1;
    if (settled) current = target;
    return { point: current, settled };
  };
  return {
    move: (point, elapsedMs = 0) => {
      // Elapsed idle time belongs to the previous target, never to the newly received input.
      step(elapsedMs);
      target = point;
      if (strength === 0 || point === null || current === null) current = point;
      return current;
    },
    step,
    finish: () => target,
  };
}
