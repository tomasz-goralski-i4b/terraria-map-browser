import { collectTransferList, type WorldTilesResult } from "@studio/world-codec";

function cancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException("Export cancelled", "AbortError");
}

/** Copies large buffers in yielding slices, preserving all view aliases without detaching the live world. */
export async function snapshotForExport(world: WorldTilesResult, signal: AbortSignal): Promise<WorldTilesResult> {
  const buffers = new Map<ArrayBuffer, ArrayBuffer>();
  for (const buffer of collectTransferList(world)) {
    cancelled(signal);
    const source = new Uint8Array(buffer);
    const copy = new Uint8Array(source.length);
    buffers.set(buffer, copy.buffer);
    for (let offset = 0; offset < source.length; offset += 1 << 20) {
      cancelled(signal);
      copy.set(source.subarray(offset, offset + (1 << 20)), offset);
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
  }
  cancelled(signal);
  const objects = new WeakMap<object, unknown>();
  const clone = (value: unknown): unknown => {
    if (value === null || typeof value !== "object") return value;
    if (objects.has(value)) return objects.get(value);
    if (value instanceof ArrayBuffer) return buffers.get(value) ?? value.slice(0);
    if (ArrayBuffer.isView(value)) {
      const buffer = buffers.get(value.buffer as ArrayBuffer);
      if (buffer === undefined) return structuredClone(value);
      if (value instanceof DataView) return new DataView(buffer, value.byteOffset, value.byteLength);
      const typed = value as ArrayBufferView & { readonly BYTES_PER_ELEMENT: number };
      const Constructor = value.constructor as new (buffer: ArrayBuffer, offset: number, length: number) => ArrayBufferView;
      return new Constructor(buffer, value.byteOffset, value.byteLength / typed.BYTES_PER_ELEMENT);
    }
    const result: unknown[] | Record<string, unknown> = Array.isArray(value) ? [] : {};
    objects.set(value, result);
    for (const [key, child] of Object.entries(value)) {
      (result as Record<string, unknown>)[key] = clone(child);
    }
    return result;
  };
  // The clone preserves this typed record's fields and every typed view's constructor, offset and length.
  return clone(world) as WorldTilesResult;
}
