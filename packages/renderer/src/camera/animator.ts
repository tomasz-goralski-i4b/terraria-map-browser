import { clampCamera, panBy, screenToTile, zoomAt } from "./camera.js";
import type { Camera, Size } from "./camera.js";

/**
 * Stiffness of the critically damped zoom spring (rad/ms): within 2 % of a step in about 290 ms, within 0.1 % of the
 * target about 380 ms after the last notch of a replayed wheel trace (#231).
 */
const ZOOM_SPRING_PER_MS = 0.02;
const PAN_DECAY_PER_MS = 0.008;
/** The spring settles on the target below this log-zoom distance (a sub-pixel step on a 4K viewport). */
const ZOOM_EPSILON = 1e-4;
const VELOCITY_EPSILON = 0.005;
const RELEASE_WINDOW_MS = 100;

interface Point { readonly x: number; readonly y: number }
interface DragSegment { readonly start: number; readonly end: number; readonly dx: number; readonly dy: number }
const STILL: Point = { x: 0, y: 0 };

export interface CameraStep {
  readonly camera: Camera;
  readonly settled: boolean;
}

/** Pure camera motion driven by a caller-supplied monotonic millisecond clock. */
export class CameraAnimator {
  private drawn: Camera;
  private destination: Camera;
  private viewport: Size;
  private world: Size;
  private readonly now: () => number;
  private lastStep: number;
  private direct = false;
  private reduced = false;
  private anchor: Point = STILL;
  private anchorTile: Point = STILL;
  /** Log-zoom per millisecond; it carries over between notches so they blend into one motion. */
  private zoomVelocity = 0;
  private kinetic: Point = STILL;
  private held: Point = STILL;
  private dragStart = 0;
  private lastDrag = 0;
  private readonly segments: DragSegment[] = [];

  constructor(camera: Camera, viewport: Size, world: Size, now: () => number) {
    this.drawn = clampCamera(camera, viewport, world);
    this.destination = this.drawn;
    this.viewport = viewport;
    this.world = world;
    this.now = now;
    this.lastStep = now();
  }

  get current(): Camera { return this.drawn; }
  get target(): Camera { return this.destination; }
  /** Release velocity in backing pixels per millisecond (held keys have a separate velocity). */
  get velocity(): Point { return this.kinetic; }

  reset(camera: Camera, viewport: Size, world: Size): void {
    this.viewport = viewport;
    this.world = world;
    this.drawn = clampCamera(camera, viewport, world);
    this.destination = this.drawn;
    this.direct = false;
    this.zoomVelocity = 0;
    this.cancelMotion();
    this.segments.length = 0;
    this.lastStep = this.now();
  }

  setReducedMotion(reduce: boolean): void {
    this.reduced = reduce;
    if (reduce) this.kinetic = STILL;
  }

  zoom(factor: number, x: number, y: number, direct = false): void {
    // A glide in progress keeps its clock (the next frame moves on from the last one); an idle one starts now.
    if (direct || (this.zoomVelocity === 0 && this.drawn.zoom === this.destination.zoom)) this.lastStep = this.now();
    this.cancelMotion();
    // Pending direct gestures already contain the accumulated pan/pinch; eased retargets anchor to the drawn view.
    const base = this.direct ? this.destination : this.drawn;
    const zoom = this.destination.zoom * factor;
    this.anchor = { x, y };
    this.anchorTile = screenToTile(base, x, y);
    this.destination = zoomAt(base, zoom, x, y, this.viewport, this.world);
    this.direct = direct;
    // A direct gesture ends the glide now, so a notch arriving before the next frame starts from rest.
    if (direct) this.zoomVelocity = 0;
  }

  beginDrag(): void {
    this.cancelMotion();
    this.settleZoom();
    this.segments.length = 0;
    this.dragStart = this.now();
    this.lastDrag = this.dragStart;
  }

  drag(dx: number, dy: number): void {
    const end = this.now();
    this.segments.push({ start: this.lastDrag, end, dx, dy });
    this.lastDrag = end;
    while (this.segments[0] !== undefined && this.segments[0].end <= end - RELEASE_WINDOW_MS) this.segments.shift();
    this.pan(dx, dy);
  }

  endDrag(cancel = false): void {
    const end = this.now();
    const start = Math.max(this.dragStart, end - RELEASE_WINDOW_MS);
    const duration = end - start;
    let dx = 0;
    let dy = 0;
    if (!cancel && !this.reduced && duration > 0) {
      for (const segment of this.segments) {
        const overlap = Math.max(0, Math.min(end, segment.end) - Math.max(start, segment.start));
        const fraction = segment.end > segment.start ? overlap / (segment.end - segment.start) : 0;
        dx += segment.dx * fraction;
        dy += segment.dy * fraction;
      }
      this.kinetic = { x: dx / duration, y: dy / duration };
    } else this.kinetic = STILL;
    this.segments.length = 0;
    this.lastStep = end;
  }

  pan(dx: number, dy: number): void {
    this.settleZoom();
    this.destination = panBy(this.destination, dx, dy, this.viewport, this.world);
    this.direct = true;
  }

  /** A direct gesture takes over from the drawn view: an unfinished zoom glide stops there, velocity included. */
  private settleZoom(): void {
    if (this.direct) return;
    this.destination = this.drawn;
    this.zoomVelocity = 0;
  }

  keyPan(x: number, y: number): void {
    this.kinetic = STILL;
    this.held = { x, y };
    this.lastStep = this.now();
  }

  cancelMotion(): void {
    this.kinetic = STILL;
    this.held = STILL;
  }

  step(): CameraStep {
    const time = this.now();
    const dt = Math.max(0, time - this.lastStep);
    this.lastStep = time;
    if (this.direct || this.reduced) {
      this.drawn = this.destination;
      this.direct = false;
      this.zoomVelocity = 0;
    } else {
      // A critically damped spring on log-zoom, integrated in closed form so frame subdivision does not change it.
      const offset = Math.log(this.drawn.zoom / this.destination.zoom);
      const spring = ZOOM_SPRING_PER_MS;
      const decay = Math.exp(-spring * dt);
      const drive = this.zoomVelocity + spring * offset;
      const remaining = (offset + drive * dt) * decay;
      const velocity = (this.zoomVelocity - spring * drive * dt) * decay;
      // Never past the target (it may be the zoom limit): crossing it, or coming close and slow, is arriving.
      if (offset === 0 || remaining * offset <= 0
        || (Math.abs(remaining) <= ZOOM_EPSILON && Math.abs(velocity) <= ZOOM_EPSILON * spring)) {
        this.drawn = this.destination;
        this.zoomVelocity = 0;
      } else {
        const zoom = this.destination.zoom * Math.exp(remaining);
        this.zoomVelocity = velocity;
        this.drawn = clampCamera({
          x: this.anchorTile.x - this.anchor.x / zoom, y: this.anchorTile.y - this.anchor.y / zoom, zoom,
        }, this.viewport, this.world);
      }
    }

    // Integrating exponential velocity analytically makes inertia independent of frame subdivision, too.
    const decay = Math.exp(-PAN_DECAY_PER_MS * dt);
    const distance = (1 - decay) / PAN_DECAY_PER_MS;
    const dx = this.kinetic.x * distance + this.held.x * dt;
    const dy = this.kinetic.y * distance + this.held.y * dt;
    if (dx !== 0 || dy !== 0) {
      const before = this.drawn;
      this.drawn = panBy(before, dx, dy, this.viewport, this.world);
      const vx = this.drawn.x === before.x ? 0 : this.kinetic.x * decay;
      const vy = this.drawn.y === before.y ? 0 : this.kinetic.y * decay;
      this.kinetic = Math.hypot(vx, vy) <= VELOCITY_EPSILON ? STILL : { x: vx, y: vy };
      // Panning deliberately moves the zoom anchor. Translate it and the target by the drawn tile delta,
      // so a held arrow key cannot discard an unfinished zoom glide.
      const offset = { x: this.drawn.x - before.x, y: this.drawn.y - before.y };
      this.anchorTile = { x: this.anchorTile.x + offset.x, y: this.anchorTile.y + offset.y };
      this.destination = clampCamera({
        ...this.destination, x: this.destination.x + offset.x, y: this.destination.y + offset.y,
      }, this.viewport, this.world);
    } else if (Math.hypot(this.kinetic.x, this.kinetic.y) <= VELOCITY_EPSILON) this.kinetic = STILL;

    return {
      camera: this.drawn,
      settled: this.drawn.zoom === this.destination.zoom && this.kinetic.x === 0 && this.kinetic.y === 0
        && this.held.x === 0 && this.held.y === 0,
    };
  }
}

/** Wheel delta expressed in CSS pixels: one line is 16 px; one page is the viewport height. */
export function wheelPixels(delta: number, mode: number, pageHeight: number): number {
  return delta * (mode === 1 ? 16 : mode === 2 ? pageHeight : 1);
}
