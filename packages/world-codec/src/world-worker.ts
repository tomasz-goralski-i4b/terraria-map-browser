// Worker entry: parses worlds off the main thread (protocol in worker-protocol.ts).
import { WorldFormatError } from "./world-format-error.js";
import { readWorldTiles } from "./tiles.js";
import {
  collectTransferList,
  type WorldWorkerFailure,
  type WorldWorkerRequest,
  type WorldWorkerResponse,
} from "./worker-protocol.js";

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorldWorkerRequest>) => void) | null;
  postMessage(message: WorldWorkerResponse, options?: { transfer: Transferable[] }): void;
}
const scope = globalThis as unknown as WorkerScope;

/** Requests cancelled while their input was still being read; a late result is dropped. */
const cancelled = new Set<number>();

function toFailure(error: unknown): WorldWorkerFailure {
  if (error instanceof WorldFormatError) return { code: error.kind, offset: error.offset, message: error.message };
  return { code: "Internal", offset: 0, message: error instanceof Error ? error.message : String(error) };
}

async function parse(requestId: number, input: File | ArrayBuffer): Promise<void> {
  try {
    const buffer = input instanceof ArrayBuffer ? input : await input.arrayBuffer();
    if (cancelled.has(requestId)) return;
    const result = readWorldTiles(new Uint8Array(buffer));
    scope.postMessage({ type: "parsed", requestId, result }, { transfer: collectTransferList(result) });
  } catch (error) {
    if (!cancelled.has(requestId)) scope.postMessage({ type: "failed", requestId, error: toFailure(error) });
  } finally {
    cancelled.delete(requestId);
  }
}

scope.onmessage = (event) => {
  const request = event.data;
  if (request.type === "cancel") cancelled.add(request.requestId);
  else void parse(request.requestId, request.input);
};
