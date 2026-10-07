// Worker entry for the app: parses worlds off the main thread with the codec (protocol: @studio/world-codec).
import {
  collectTransferList,
  readWorldTiles,
  WorldFormatError,
  type WorldWorkerFailure,
  type WorldWorkerRequest,
  type WorldWorkerResponse,
} from "@studio/world-codec";

interface WorkerScope {
  onmessage: ((event: MessageEvent<WorldWorkerRequest>) => void) | null;
  postMessage(message: WorldWorkerResponse, options?: { transfer: Transferable[] }): void;
}
const scope = globalThis as unknown as WorkerScope;

function toFailure(error: unknown): WorldWorkerFailure {
  if (error instanceof WorldFormatError) return { code: error.kind, offset: error.offset, message: error.message };
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

scope.onmessage = (event) => {
  void parse(event.data.requestId, event.data.input);
};
