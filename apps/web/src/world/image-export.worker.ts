import { terrariaMapPalette, type ChunkLayers } from "@studio/renderer";
import { viewWorld, type ContentRef, type WorldPlanes } from "@studio/world-model";
import type { Area } from "./area-clipboard.js";
import { encodeMapImage, imageBands, type ImageBand, type ImageFormat } from "./image-export.js";

/** Map colours: the Worker renders the bands itself from a copy of the planes. */
export interface MapImageRequest {
  readonly type: "map";
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

/** Textures are drawn on the main thread (WebGL2): their bands arrive one by one between `start` and `end`. */
export type ImageExportMessage =
  | MapImageRequest
  | { readonly type: "start"; readonly width: number; readonly height: number; readonly format: ImageFormat }
  | { readonly type: "band"; readonly band: ImageBand }
  | { readonly type: "end" };

export type ImageExportResponse =
  | { readonly type: "progress"; readonly fraction: number }
  | { readonly type: "ready"; readonly image: Blob }
  | { readonly type: "failed"; readonly message: string };

interface ImageExportScope {
  onmessage: ((event: MessageEvent<ImageExportMessage>) => void) | null;
  postMessage(message: ImageExportResponse): void;
}
const scope = globalThis as unknown as ImageExportScope;

let incoming: ReadableStreamDefaultController<ImageBand> | null = null;

async function* read(stream: ReadableStream<ImageBand>): AsyncGenerator<ImageBand> {
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    yield value;
  }
}

function encode(format: ImageFormat, width: number, height: number, bands: Iterable<ImageBand> | AsyncIterable<ImageBand>): void {
  encodeMapImage(format, width, height, bands, (rows) => { scope.postMessage({ type: "progress", fraction: rows / height }); })
    .then((image) => { scope.postMessage({ type: "ready", image }); })
    .catch((error: unknown) => {
      scope.postMessage({ type: "failed", message: `Image export failed: ${error instanceof Error ? error.message : String(error)}` });
    });
}

/** Encodes the image band by band; the main thread only waits for progress and the finished file. */
scope.onmessage = (event) => {
  const message = event.data;
  if (message.type === "map") {
    const { width, height, surfaceY, rockY, planes, palette, area, scale, layers, format } = message;
    const world = viewWorld(width, height, planes, palette, { indicesChecked: true });
    encode(format, area.width * scale, area.height * scale, imageBands(world, area, scale, { surfaceY, rockY, layers, mapPalette: terrariaMapPalette }));
  } else if (message.type === "start") {
    encode(message.format, message.width, message.height, read(new ReadableStream<ImageBand>({ start: (controller) => { incoming = controller; } })));
  } else if (message.type === "band") incoming?.enqueue(message.band);
  else incoming?.close();
};
