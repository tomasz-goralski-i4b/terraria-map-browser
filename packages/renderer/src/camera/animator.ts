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
/** Release velocity: the last ~2 frames of a drag, so the glide continues at the speed the map was last moving. */
const RELEASE_WINDOW_MS = 40;
/**
 * A drag shows where the pointer was a little before the frame, interpolated between its samples: the map then moves
 * by the time between frames, not by how many pointer events (125 Hz, 250 Hz, 1000 Hz mice) landed in each. The delay
 * is this many of the pointer's recent event intervals, so a frame always falls between two samples and the path is
 * never guessed ahead (a guess the pointer does not follow would step the map back).
 */
const RESAMPLE_INTERVALS = 1.25;
/** At most this delay: slower input (or a pause) holds the map at the last sample until the next one. */
const MAX_RESAMPLE_LATENCY_MS = 20;
/** The recent event intervals the delay follows. */
const RESAMPLE_HISTORY = 4;

interface Point { readonly x: number; readonly y: number }
interface DragSegment { readonly start: number; readonly end: number; readonly dx: number; readonly dy: number }
/** A drag's pointer path: the total screen displacement since it began, at an event's timestamp. */
interface DragSample { readonly time: number; readonly x: number; readonly y: number }
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
  /** The drag's pointer path, oldest first; empty when the destination shows all of it. */
  private readonly path: DragSample[] = [];
  /** The point of the path the destination shows. */
  private shown: Point = STILL;
  /** The path has its last sample (the drag ended): the steps show it to its end, then drop it. */
  private released = false;
  /** The path time the last step showed; it never goes back, so the map never steps back along the path. */
  private sampledAt = -Infinity;
  /** The resampling delay (ms), from the pointer's recent event intervals. */
  private latency = 0;

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
    this.endPath();
    this.cancelMotion();
    this.segments.length = 0;
    this.lastStep = this.now();
  }

  setReducedMotion(reduce: boolean): void {
    this.reduced = reduce;
    if (reduce) {
      this.catchUp();
      this.kinetic = STILL;
    }
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

  /** Starts a drag at `time`, the press's timestamp on the clock's time base. */
  beginDrag(time: number = this.now()): void {
    time = this.eventTime(time);
    this.cancelMotion();
    this.settleZoom();
    this.segments.length = 0;
    this.dragStart = time;
    this.lastDrag = time;
    this.released = false;
    this.path.push({ time, x: 0, y: 0 });
  }

  /**
   * One pointer move of a drag by (dx, dy) backing pixels at `time`, the event's timestamp on the clock's time base.
   * The steps show it resampled to their frame time.
   */
  drag(dx: number, dy: number, time: number = this.now()): void {
    const end = Math.max(this.eventTime(time), this.lastDrag);
    this.segments.push({ start: this.lastDrag, end, dx, dy });
    this.lastDrag = end;
    while (this.segments[0] !== undefined && this.segments[0].end <= end - RELEASE_WINDOW_MS) this.segments.shift();
    if (this.reduced) {
      this.pan(dx, dy);
      return;
    }
    this.settleZoom();
    const last = this.path.at(-1) ?? { time: end, x: 0, y: 0 };
    if (this.path.length === 0) this.path.push(last);
    this.path.push({ time: end, x: last.x + dx, y: last.y + dy });
    // Samples before the one at or just before the shown time are never read again (a few stay for the intervals).
    while (this.path.length > RESAMPLE_HISTORY + 1 && (this.path[1]?.time ?? Infinity) <= this.sampledAt) this.path.shift();
    let intervals = 0;
    let count = 0;
    for (let index = this.path.length - 1; index > 0 && count < RESAMPLE_HISTORY; index--, count++) {
      intervals += Math.min(MAX_RESAMPLE_LATENCY_MS, (this.path[index]?.time ?? 0) - (this.path[index - 1]?.time ?? 0));
    }
    this.latency = Math.min(MAX_RESAMPLE_LATENCY_MS, count === 0 ? 0 : RESAMPLE_INTERVALS * intervals / count);
  }

  endDrag(cancel = false, time: number = this.now()): void {
    const end = Math.max(this.eventTime(time), this.lastDrag);
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
    // The frames show the path up to the release a resampling delay behind: the glide starts after it, so its first
    // frame moves about as far as a drag frame did.
    this.released = true;
    const gliding = this.path.length > 0 && (this.kinetic.x !== 0 || this.kinetic.y !== 0);
    this.lastStep = gliding ? end + this.latency : end;
  }

  /** An event's timestamp, never later than the clock: one from another time base cannot run ahead of the frames. */
  private eventTime(time: number): number {
    return Math.min(time, this.now());
  }

  pan(dx: number, dy: number): void {
    this.catchUp();
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
    this.catchUp();
    this.kinetic = STILL;
    this.held = { x, y };
    this.lastStep = this.now();
  }

  cancelMotion(): void {
    this.catchUp();
    this.kinetic = STILL;
    this.held = STILL;
  }

  /** Another gesture takes over: the destination shows the rest of the drag's path at once, and the path ends. */
  private catchUp(): void {
    const last = this.path.at(-1);
    if (last === undefined) return;
    this.showPath(last);
    this.endPath();
  }

  private endPath(): void {
    this.path.length = 0;
    this.shown = STILL;
    this.released = false;
    this.sampledAt = -Infinity;
    this.latency = 0;
  }

  private showPath(point: Point): void {
    const dx = point.x - this.shown.x;
    const dy = point.y - this.shown.y;
    this.shown = point;
    if (dx === 0 && dy === 0) return;
    this.destination = panBy(this.destination, dx, dy, this.viewport, this.world);
    this.direct = true;
  }

  /**
   * Where the drag's pointer was a resampling delay before `time`, never earlier than the last step showed.
   * `pending` while a later step shows more of the path without another sample; `done` once a released path is shown
   * to its end.
   */
  private resample(time: number): { readonly point: Point; readonly pending: boolean; readonly done: boolean } | null {
    const path = this.path;
    const last = path.at(-1);
    if (last === undefined) return null;
    const at = Math.max(this.sampledAt, time - this.latency);
    this.sampledAt = at;
    // The pointer has not been seen this late yet: hold at its last sample until the next one.
    if (at >= last.time) return { point: last, pending: false, done: this.released };
    let index = path.length - 1;
    while (index > 0 && (path[index - 1]?.time ?? -Infinity) > at) index--;
    const after = path[index] ?? last;
    const before = path[index - 1];
    if (before === undefined || after.time <= before.time) return { point: after, pending: true, done: false };
    const fraction = Math.min(1, Math.max(0, (at - before.time) / (after.time - before.time)));
    return {
      point: { x: before.x + (after.x - before.x) * fraction, y: before.y + (after.y - before.y) * fraction },
      pending: true,
      done: false,
    };
  }

  /** Advances to `time`: the frame's timestamp (requestAnimationFrame's) on the clock's time base. */
  step(time: number = this.now()): CameraStep {
    const dt = Math.max(0, time - this.lastStep);
    this.lastStep = Math.max(time, this.lastStep);
    const sampled = this.resample(time);
    if (sampled !== null) {
      this.showPath(sampled.point);
      if (sampled.done) this.endPath();
    }
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
        && this.held.x === 0 && this.held.y === 0 && sampled?.pending !== true,
    };
  }
}

/** Wheel delta expressed in CSS pixels: one line is 16 px; one page is the viewport height. */
export function wheelPixels(delta: number, mode: number, pageHeight: number): number {
  return delta * (mode === 1 ? 16 : mode === 2 ? pageHeight : 1);
}
