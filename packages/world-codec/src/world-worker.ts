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

/** Requests whose input is still being read; only these can still be stopped (a decode cannot be interrupted). */
const active = new Set<number>();
/** Active requests cancelled while their input was being read; their result is dropped. */
const cancelled = new Set<number>();

function toFailure(error: unknown): WorldWorkerFailure {
  if (error instanceof WorldFormatError) return { code: error.kind, offset: error.offset, message: error.message };
  return { code: "Internal", offset: 0, message: error instanceof Error ? error.message : String(error) };
}

async function parse(requestId: number, input: File | ArrayBuffer): Promise<void> {
  active.add(requestId);
  try {
    const buffer = input instanceof ArrayBuffer ? input : await input.arrayBuffer();
    if (cancelled.has(requestId)) return;
    const result = readWorldTiles(new Uint8Array(buffer));
    scope.postMessage({ type: "parsed", requestId, result }, { transfer: collectTransferList(result) });
  } catch (error) {
    if (!cancelled.has(requestId)) scope.postMessage({ type: "failed", requestId, error: toFailure(error) });
  } finally {
    active.delete(requestId);
    cancelled.delete(requestId);
  }
}

scope.onmessage = (event) => {
  const request = event.data;
  if (request.type === "cancel") {
    // A completed or unknown request has nothing left to stop; remembering its ID would block a later request reusing it.
    if (active.has(request.requestId)) cancelled.add(request.requestId);
  } else void parse(request.requestId, request.input);
};
