import type { TilePoint } from "../shell/view-store.js";

export type MeasurementKind = "line" | "rectangle";
export interface Measurement {
  readonly id: number;
  readonly name: string;
  readonly kind: MeasurementKind;
  readonly start: TilePoint;
  readonly end: TilePoint;
  readonly visible: boolean;
}
export interface MeasurementDisplay {
  readonly dimensions: boolean;
  readonly components: boolean;
  readonly angle: boolean;
}
export interface RulerSettings extends MeasurementDisplay {
  readonly mode: MeasurementKind;
  readonly keep: boolean;
}
export const DEFAULT_RULER: RulerSettings = { mode: "line", keep: true, dimensions: true, components: false, angle: true };
export type MeasurementPart = "start" | "end" | "move" | "top-left" | "top-right" | "bottom-left" | "bottom-right";
export interface MeasurementHit { readonly id: number; readonly part: MeasurementPart }
export interface MeasurementLabel { readonly x: number; readonly y: number; readonly offsetX: number; readonly offsetY: number; readonly text: string; readonly align: "center" | "end" }

/** Measurements use tile boundaries, not the inclusive tile count of a selection. */
export function snapBoundary(point: TilePoint, bounds: { readonly width: number; readonly height: number }): TilePoint {
  return { x: Math.max(0, Math.min(bounds.width, Math.round(point.x))), y: Math.max(0, Math.min(bounds.height, Math.round(point.y))) };
}
export function measurementDimensions(measurement: Measurement): { readonly width: number; readonly height: number; readonly length: number; readonly angle: number } {
  const width = Math.abs(measurement.end.x - measurement.start.x), height = Math.abs(measurement.end.y - measurement.start.y);
  return { width, height, length: Math.hypot(width, height), angle: Math.atan2(height, width) * 180 / Math.PI };
}
const numberFormat = new Intl.NumberFormat("en", { maximumFractionDigits: 2 });
/** One block per step along the dominant axis; endpoints denote boundaries, so no extra endpoint is counted. */
export function measurementLength(measurement: Measurement): number {
  return Math.max(Math.abs(measurement.end.x - measurement.start.x), Math.abs(measurement.end.y - measurement.start.y));
}
export function measurementBlocks(measurement: Measurement): readonly TilePoint[] {
  const count = measurementLength(measurement), dx = measurement.end.x - measurement.start.x, dy = measurement.end.y - measurement.start.y;
  return Array.from({ length: count }, (_, index) => ({ x: Math.floor(measurement.start.x + (index + 0.5) * dx / count), y: Math.floor(measurement.start.y + (index + 0.5) * dy / count) }));
}
export type MeasurementSegment = readonly [TilePoint, TilePoint];
/** The transparent outline of the union of raster blocks, with collinear edges merged into long strokes. */
export function measurementSegments(measurement: Measurement): readonly MeasurementSegment[] {
  const dx = measurement.end.x - measurement.start.x, dy = measurement.end.y - measurement.start.y;
  const left = Math.min(measurement.start.x, measurement.end.x), top = Math.min(measurement.start.y, measurement.end.y);
  if (dx === 0 && dy === 0) return [];
  if (measurement.kind === "rectangle" || dx === 0 || dy === 0) {
    const right = left + (Math.abs(dx) || 1), bottom = top + (Math.abs(dy) || 1);
    return [[{ x: left, y: top }, { x: right, y: top }], [{ x: right, y: top }, { x: right, y: bottom }],
      [{ x: right, y: bottom }, { x: left, y: bottom }], [{ x: left, y: bottom }, { x: left, y: top }]];
  }
  const cells = measurementBlocks(measurement), occupied = new Set(cells.map(({ x, y }) => `${String(x)},${String(y)}`));
  const has = (x: number, y: number): boolean => occupied.has(`${String(x)},${String(y)}`);
  const rows = new Map<string, { readonly horizontal: boolean; readonly fixed: number; readonly intervals: [number, number][] }>();
  const edge = (horizontal: boolean, fixed: number, first: number, last: number): void => {
    const key = `${horizontal ? "h" : "v"}${String(fixed)}`;
    let row = rows.get(key);
    if (row === undefined) { row = { horizontal, fixed, intervals: [] }; rows.set(key, row); }
    row.intervals.push([first, last]);
  };
  for (const { x, y } of cells) {
    if (!has(x, y - 1)) edge(true, y, x, x + 1);
    if (!has(x, y + 1)) edge(true, y + 1, x, x + 1);
    if (!has(x - 1, y)) edge(false, x, y, y + 1);
    if (!has(x + 1, y)) edge(false, x + 1, y, y + 1);
  }
  const segments: MeasurementSegment[] = [];
  for (const { horizontal, fixed, intervals } of rows.values()) {
    intervals.sort((a, b) => a[0] - b[0]);
    let current: [number, number] | null = null;
    const emit = (range: readonly [number, number]): void => {
      segments.push(horizontal ? [{ x: range[0], y: fixed }, { x: range[1], y: fixed }] : [{ x: fixed, y: range[0] }, { x: fixed, y: range[1] }]);
    };
    for (const interval of intervals) {
      if (current === null) current = [...interval];
      else if (interval[0] <= current[1]) current[1] = Math.max(current[1], interval[1]);
      else { emit(current); current = [...interval]; }
    }
    if (current !== null) emit(current);
  }
  return segments;
}
export function measurementLabels(measurement: Measurement, display: MeasurementDisplay): readonly MeasurementLabel[] {
  const { width, height, angle } = measurementDimensions(measurement);
  const length = measurementLength(measurement), unit = "blocks";
  const value = (amount: number): string => numberFormat.format(amount);
  const midX = (measurement.start.x + measurement.end.x) / 2, midY = (measurement.start.y + measurement.end.y) / 2;
  if (measurement.kind === "rectangle") return display.dimensions ? [
    { x: midX, y: Math.min(measurement.start.y, measurement.end.y), offsetX: 0, offsetY: -14, text: `${value(width)} ${unit}`, align: "center" },
    { x: Math.min(measurement.start.x, measurement.end.x), y: midY, offsetX: -12, offsetY: 0, text: `${value(height)} ${unit}`, align: "end" },
  ] : [];
  const labels: MeasurementLabel[] = [];
  const parts = [display.dimensions ? `${value(length)} ${unit}` : "", display.angle ? `${angle.toFixed(2)}°` : ""].filter(Boolean);
  if (parts.length > 0) labels.push({ x: midX, y: midY, offsetX: 0, offsetY: -16, text: parts.join(" · "), align: "center" });
  if (display.components) labels.push({ x: midX, y: midY, offsetX: 0, offsetY: 14, text: `ΔX ${value(width)} · ΔY ${value(height)}`, align: "center" });
  return labels;
}

function distanceToSegment(point: TilePoint, start: TilePoint, end: TilePoint): number {
  const dx = end.x - start.x, dy = end.y - start.y;
  const fraction = dx === 0 && dy === 0 ? 0 : Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - start.x - fraction * dx, point.y - start.y - fraction * dy);
}
export function measurementCorners(measurement: Measurement): readonly { readonly point: TilePoint; readonly part: MeasurementPart }[] {
  if (measurement.kind === "line") return [{ point: measurement.start, part: "start" }, { point: measurement.end, part: "end" }];
  const left = Math.min(measurement.start.x, measurement.end.x), right = Math.max(measurement.start.x, measurement.end.x);
  const top = Math.min(measurement.start.y, measurement.end.y), bottom = Math.max(measurement.start.y, measurement.end.y);
  return [{ point: { x: left, y: top }, part: "top-left" }, { point: { x: right, y: top }, part: "top-right" },
    { point: { x: right, y: bottom }, part: "bottom-right" }, { point: { x: left, y: bottom }, part: "bottom-left" }];
}
export function hitMeasurement(items: readonly Measurement[], point: TilePoint, radius: number, selected: number | null): MeasurementHit | null {
  const ordered = [...items].reverse().filter((item) => item.visible);
  const active = ordered.find((item) => item.id === selected);
  if (active !== undefined) {
    for (const corner of measurementCorners(active)) if (Math.hypot(point.x - corner.point.x, point.y - corner.point.y) <= radius) return { id: active.id, part: corner.part };
  }
  for (const item of ordered) {
    const corners = measurementCorners(item);
    if (item.kind === "line") {
      const left = Math.min(item.start.x, item.end.x), top = Math.min(item.start.y, item.end.y);
      const right = Math.max(item.start.x, item.end.x) + (item.start.x === item.end.x ? 1 : 0);
      const bottom = Math.max(item.start.y, item.end.y) + (item.start.y === item.end.y ? 1 : 0);
      if (point.x < left - radius || point.x > right + radius || point.y < top - radius || point.y > bottom + radius) continue;
      if (measurementBlocks(item).some((cell) => point.x >= cell.x - radius && point.x <= cell.x + 1 + radius && point.y >= cell.y - radius && point.y <= cell.y + 1 + radius)) return { id: item.id, part: "move" };
    } else {
      for (let index = 0; index < 4; index++) {
        const from = corners[index], to = corners[(index + 1) % 4];
        if (from !== undefined && to !== undefined && distanceToSegment(point, from.point, to.point) <= radius) return { id: item.id, part: "move" };
      }
      if (item.id === selected && point.x >= Math.min(item.start.x, item.end.x) && point.x <= Math.max(item.start.x, item.end.x)
        && point.y >= Math.min(item.start.y, item.end.y) && point.y <= Math.max(item.start.y, item.end.y)) return { id: item.id, part: "move" };
    }
  }
  return null;
}
