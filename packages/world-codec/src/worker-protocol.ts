import type { WorldFormatErrorKind } from "./world-format-error.js";
import type { WorldTilesResult } from "./tiles.js";

/**
 * Main thread → Worker. `input` is a `File` (read inside the Worker) or an ArrayBuffer that is transferred.
 * Save requests are structured clones without input transfers: the caller keeps its planes and source.
 * There is no cancel message: synchronous codec work is cancelled by terminating the Worker.
 */
export type WorldWorkerRequest =
  | { readonly type: "parse"; readonly requestId: number; readonly input: File | ArrayBuffer }
  | { readonly type: "save"; readonly requestId: number; readonly world: WorldTilesResult };

/** Structured failure; `code` is a format error kind, or `Cancelled` / `Internal`. */
export interface WorldWorkerFailure {
  readonly code: WorldFormatErrorKind | "Cancelled" | "Internal";
  readonly offset: number;
  readonly message: string;
}

/** Worker → main thread. Planes and the retained source buffer travel in the transfer list. */
export type WorldWorkerResponse =
  | { readonly type: "parsed"; readonly requestId: number; readonly result: WorldTilesResult }
  | { readonly type: "saved"; readonly requestId: number; readonly output: ArrayBuffer }
  | { readonly type: "failed"; readonly requestId: number; readonly error: WorldWorkerFailure };

/** Every unique plane and envelope source ArrayBuffer, once each, for `postMessage(..., { transfer })`. */
export function collectTransferList(result: WorldTilesResult): ArrayBuffer[] {
  const unique = new Set<ArrayBuffer>();
  const planes: ArrayBufferView[] = Object.values<ArrayBufferView>(result.planes as unknown as Record<string, ArrayBufferView>);
  for (const plane of planes) unique.add(plane.buffer as ArrayBuffer);
  unique.add(result.envelope.source.buffer as ArrayBuffer);
  return [...unique];
}
