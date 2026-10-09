import { writeWorld, WorldFormatError, type WorldTilesResult } from "@studio/world-codec";
import type { ExportResponse } from "./export-protocol.js";
import { verifyWrittenWorld } from "./verify-written.js";

interface ExportScope {
  onmessage: ((event: MessageEvent<WorldTilesResult>) => void) | null;
  postMessage(message: ExportResponse, options?: { transfer: Transferable[] }): void;
}
const scope = globalThis as unknown as ExportScope;

/** Encodes the world, then reads the bytes back: only a file that decodes to the same world leaves the Worker. */
scope.onmessage = (event) => {
  try {
    scope.postMessage({ type: "progress", stage: "encoding" });
    const output = writeWorld(event.data);
    scope.postMessage({ type: "progress", stage: "verifying" });
    const difference = verifyWrittenWorld(event.data, output);
    if (difference !== null) {
      scope.postMessage({ type: "failed", message: `Verification failed: ${difference}. Nothing was saved.` });
      return;
    }
    scope.postMessage({ type: "ready", output }, { transfer: [output] });
  } catch (error) {
    const message = error instanceof WorldFormatError
      ? `${error.kind} at offset ${String(error.offset)}: ${error.message}`
      : `Worker error: ${error instanceof Error ? error.message : String(error)}`;
    scope.postMessage({ type: "failed", message });
  }
};
