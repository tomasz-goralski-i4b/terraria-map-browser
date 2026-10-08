import type { Camera, Size } from "./camera.js";

export interface CameraStep {
  readonly camera: Camera;
  readonly settled: boolean;
}

/** Pure camera motion driven by a caller-supplied monotonic millisecond clock. */
export class CameraAnimator {
  constructor(_camera: Camera, _viewport: Size, _world: Size, _now: () => number) { throw new Error("not implemented"); }
  get current(): Camera { throw new Error("not implemented"); }
  get target(): Camera { throw new Error("not implemented"); }
  get velocity(): { readonly x: number; readonly y: number } { throw new Error("not implemented"); }
  reset(_camera: Camera, _viewport: Size, _world: Size): void { throw new Error("not implemented"); }
  setReducedMotion(_reduce: boolean): void { throw new Error("not implemented"); }
  zoom(_factor: number, _x: number, _y: number, _direct = false): void { throw new Error("not implemented"); }
  beginDrag(): void { throw new Error("not implemented"); }
  drag(_dx: number, _dy: number): void { throw new Error("not implemented"); }
  endDrag(_cancel = false): void { throw new Error("not implemented"); }
  pan(_dx: number, _dy: number): void { throw new Error("not implemented"); }
  keyPan(_x: number, _y: number): void { throw new Error("not implemented"); }
  cancelMotion(): void { throw new Error("not implemented"); }
  step(): CameraStep { throw new Error("not implemented"); }
}

/** Wheel delta expressed in CSS pixels: one line is 16 px; one page is the viewport height. */
export function wheelPixels(_delta: number, _mode: number, _pageHeight: number): number { throw new Error("not implemented"); }
