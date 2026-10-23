import { terrariaMapPalette, type ChunkLayers } from "@studio/renderer";
import { viewWorld, type ContentRef, type WorldPlanes } from "@studio/world-model";
import type { Area } from "./area-clipboard.js";
import { encodeMapImage, imageBands, type ImageFormat } from "./image-export.js";

export interface ImageExportRequest {
  readonly width: number;
  readonly height: number;
  readonly surfaceY: number;
  readonly rockY: number;
  readonly planes: WorldPlanes;
  readonly palette: readonly ContentRef[];
  readonly area: Area;
  readonly scale: number;
  readonly layers: ChunkLayers;
  readonly format: ImageFormat;
}

export type ImageExportResponse =
  | { readonly type: "progress"; readonly fraction: number }
  | { readonly type: "ready"; readonly image: Blob }
  | { readonly type: "failed"; readonly message: string };

interface ImageExportScope {
  onmessage: ((event: MessageEvent<ImageExportRequest>) => void) | null;
  postMessage(message: ImageExportResponse): void;
}
const scope = globalThis as unknown as ImageExportScope;

/** Renders and encodes the image band by band; the main thread only waits for progress and the finished file. */
scope.onmessage = (event) => {
  const { width, height, surfaceY, rockY, planes, palette, area, scale, layers, format } = event.data;
  const world = viewWorld(width, height, planes, palette, { indicesChecked: true });
  const bands = imageBands(world, area, scale, { surfaceY, rockY, layers, mapPalette: terrariaMapPalette });
  const total = area.height * scale;
  encodeMapImage(format, area.width * scale, total, bands, (rows) => { scope.postMessage({ type: "progress", fraction: rows / total }); })
    .then((image) => { scope.postMessage({ type: "ready", image }); })
    .catch((error: unknown) => {
      scope.postMessage({ type: "failed", message: `Image export failed: ${error instanceof Error ? error.message : String(error)}` });
    });
};
