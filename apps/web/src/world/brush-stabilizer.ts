export interface BrushPoint { readonly x: number; readonly y: number }
/** Screen-space trailing cursor, advanced by elapsed animation time before tile quantization. */
export function createBrushStabilizer(start: BrushPoint, strength: number): {
  move: (point: BrushPoint | null) => void;
  step: (elapsedMs: number) => { readonly point: BrushPoint | null; readonly settled: boolean };
  finish: () => BrushPoint | null;
} {
  let target: BrushPoint | null = start;
  let current: BrushPoint | null = start;
  return {
    move: (point) => {
      target = point;
      if (point === null || current === null) current = point;
    },
    step: (elapsedMs) => {
      if (target === null || current === null) return { point: null, settled: true };
      const alpha = strength === 0 ? 1 : 1 - Math.exp(-Math.max(0, elapsedMs) / (strength * 4));
      current = { x: current.x + (target.x - current.x) * alpha, y: current.y + (target.y - current.y) * alpha };
      const settled = Math.hypot(target.x - current.x, target.y - current.y) < 0.1;
      if (settled) current = target;
      return { point: current, settled };
    },
    finish: () => target,
  };
}
