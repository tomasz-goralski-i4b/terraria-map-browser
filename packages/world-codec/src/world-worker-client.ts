import type { WorldTilesResult } from "./tiles.js";
import type { WorldWorkerFailure } from "./worker-protocol.js";

/** A parse request failed in the Worker; carries the structured code/offset and the request ID. */
export class WorldWorkerError extends Error {
  readonly code: WorldWorkerFailure["code"];
  readonly offset: number;
  readonly requestId: number;

  constructor(requestId: number, failure: WorldWorkerFailure) {
    super(failure.message);
    this.name = "WorldWorkerError";
    this.code = failure.code;
    this.offset = failure.offset;
    this.requestId = requestId;
  }
}

/** Main-thread client of the world-parsing Worker; requests are independent, a failure never poisons the next. */
export class WorldWorkerClient {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- RED stub, implemented in the green phase
  constructor(_worker: Worker) {
    throw new Error("not implemented");
  }

  /** Parses a `File` or transfers an `ArrayBuffer` (which detaches in the caller). Rejects with `WorldWorkerError`. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- RED stub, implemented in the green phase
  parse(_input: File | ArrayBuffer, _options?: { readonly signal?: AbortSignal }): Promise<WorldTilesResult> {
    throw new Error("not implemented");
  }

  /** Rejects pending requests with `Cancelled`, terminates the Worker and releases its resources. */
  dispose(): void {
    throw new Error("not implemented");
  }
}
