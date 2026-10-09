import { writeWorld, WorldFormatError, type WorldTilesResult } from "@studio/world-codec";
import type { ExportResponse } from "./export-protocol.js";

interface ExportScope {
  onmessage: ((event: MessageEvent<WorldTilesResult>) => void) | null;
  postMessage(message: ExportResponse, options?: { transfer: Transferable[] }): void;
}
const scope = globalThis as unknown as ExportScope;

scope.onmessage = (event) => {
  try {
    scope.postMessage({ type: "progress", message: "Encoding the world copy…" });
    const output = writeWorld(event.data);
    scope.postMessage({ type: "ready", output }, { transfer: [output] });
  } catch (error) {
    const message = error instanceof WorldFormatError
      ? `${error.kind} at offset ${String(error.offset)}: ${error.message}`
      : `Worker error: ${error instanceof Error ? error.message : String(error)}`;
    scope.postMessage({ type: "failed", message });
  }
};
