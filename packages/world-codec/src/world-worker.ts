// Worker entry: parses and saves worlds off the main thread (protocol in worker-protocol.ts).
import { WorldFormatError } from "./world-format-error.js";
import { readWorldTiles } from "./tiles.js";
import { writeWorld } from "./writer.js";
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

function toFailure(error: unknown): WorldWorkerFailure {
  if (error instanceof WorldFormatError) return {
    code: error.kind, offset: error.offset, message: error.message,
    ...(error.x === undefined ? {} : { x: error.x }),
    ...(error.y === undefined ? {} : { y: error.y }),
  };
  return { code: "Internal", offset: 0, message: error instanceof Error ? error.message : String(error) };
}

async function parse(requestId: number, input: File | ArrayBuffer): Promise<void> {
  try {
    const buffer = input instanceof ArrayBuffer ? input : await input.arrayBuffer();
    const result = readWorldTiles(new Uint8Array(buffer));
    scope.postMessage({ type: "parsed", requestId, result }, { transfer: collectTransferList(result) });
  } catch (error) {
    scope.postMessage({ type: "failed", requestId, error: toFailure(error) });
  }
}

// Cancellation is the client terminating this Worker; there is nothing to stop from inside.
scope.onmessage = (event) => {
  const request = event.data;
  if (request.type === "parse") {
    void parse(request.requestId, request.input);
    return;
  }
  try {
    const output = writeWorld(request.world);
    scope.postMessage({ type: "saved", requestId: request.requestId, output }, { transfer: [output] });
  } catch (error) {
    scope.postMessage({ type: "failed", requestId: request.requestId, error: toFailure(error) });
  }
};
