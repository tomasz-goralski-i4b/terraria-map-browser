import { measurementCorners, measurementLabels, measurementSegments, type Measurement, type MeasurementDisplay, type MeasurementLabel } from "./measurements.js";

export interface SceneLabel extends MeasurementLabel { readonly key: string; readonly selected: boolean }
export interface MeasurementScene { readonly data: Float32Array; readonly labels: readonly SceneLabel[] }
interface CachedMeasurement {
  readonly segments: ReturnType<typeof measurementSegments>;
  readonly variants: Map<number, Float32Array>;
  display: MeasurementDisplay | null;
  labels: readonly MeasurementLabel[];
}
// Measurements are immutable. Weak keys release geometry when an edit or world switch retires a note.
const geometry = new WeakMap<Measurement, CachedMeasurement>();
/** Rebuilt for note edits or selection only; a camera move updates uniforms and visible text positions. */
export function measurementScene(items: readonly Measurement[], draft: Measurement | null, selected: number | null, editable: boolean, display: MeasurementDisplay): MeasurementScene {
  const buffers: Float32Array[] = [], labels: SceneLabel[] = [];
  let length = 0;
  const shown = draft === null ? items : [...items.filter((item) => item.id !== draft.id), draft];
  for (const item of shown) {
    if (!item.visible) continue;
    const active = item.id === selected;
    let cached = geometry.get(item);
    if (cached === undefined) {
      cached = { segments: measurementSegments(item), variants: new Map(), display: null, labels: [] };
      geometry.set(item, cached);
    }
    const variant = active ? editable ? 2 : 1 : 0;
    let data = cached.variants.get(variant);
    if (data === undefined) {
      const values: number[] = [], width = active ? 1.5 : 1;
      for (const [from, to] of cached.segments) values.push(from.x, from.y, to.x, to.y, 1, 1, 1, width, 0);
      if (active && editable) for (const { point } of measurementCorners(item)) values.push(point.x, point.y, point.x, point.y, 1, 1, 1, 6, 1);
      data = new Float32Array(values);
      cached.variants.set(variant, data);
    }
    buffers.push(data); length += data.length;
    if (cached.display !== display) { cached.display = display; cached.labels = measurementLabels(item, display); }
    cached.labels.forEach((label, index) => { labels.push({ ...label, key: `${String(item.id)}:${String(index)}`, selected: active }); });
  }
  const data = new Float32Array(length);
  let offset = 0;
  for (const buffer of buffers) { data.set(buffer, offset); offset += buffer.length; }
  return { data, labels };
}
