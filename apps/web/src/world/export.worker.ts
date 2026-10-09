import { readWorldTiles, writeWorld, WorldFormatError } from "@studio/world-codec";
import type { ExportResponse } from "./export-protocol.js";

interface ExportScope {
  onmessage: ((event: MessageEvent<File>) => void) | null;
  postMessage(message: ExportResponse, options?: { transfer: Transferable[] }): void;
}
const scope = globalThis as unknown as ExportScope;

scope.onmessage = (event) => {
  void (async () => {
    try {
      scope.postMessage({ type: "progress", message: "Reading the opened world…" });
      const output = await event.data.arrayBuffer();
      scope.postMessage({ type: "progress", message: "Validating the world for export…" });
      // The viewer has no editing. Validate with the writer, then preserve even noncanonical source encodings.
      writeWorld(readWorldTiles(new Uint8Array(output)));
      scope.postMessage({ type: "ready", output }, { transfer: [output] });
    } catch (error) {
      const message = error instanceof WorldFormatError
        ? `${error.kind} at offset ${String(error.offset)}: ${error.message}`
        : `Worker error: ${error instanceof Error ? error.message : String(error)}`;
      scope.postMessage({ type: "failed", message });
    }
  })();
};
