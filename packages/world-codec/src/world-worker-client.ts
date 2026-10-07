import type { WorldTilesResult } from "./tiles.js";
import type { WorldWorkerFailure, WorldWorkerRequest, WorldWorkerResponse } from "./worker-protocol.js";

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

interface Pending {
  readonly resolve: (result: WorldTilesResult) => void;
  readonly reject: (error: WorldWorkerError) => void;
  readonly detach: () => void;
}

function cancelledFailure(message: string): WorldWorkerFailure {
  return { code: "Cancelled", offset: 0, message };
}

/** Main-thread client of the world-parsing Worker; requests are independent, a failure never poisons the next. */
export class WorldWorkerClient {
  readonly #worker: Worker;
  readonly #pending = new Map<number, Pending>();
  #nextRequestId = 1;
  #disposed = false;

  constructor(worker: Worker) {
    this.#worker = worker;
    worker.addEventListener("message", (event: MessageEvent<WorldWorkerResponse>) => {
      const response = event.data;
      const pending = this.#settle(response.requestId);
      if (pending === undefined) return;
      if (response.type === "parsed") pending.resolve(response.result);
      else pending.reject(new WorldWorkerError(response.requestId, response.error));
    });
    worker.addEventListener("error", (event) => {
      this.#rejectAll({ code: "Internal", offset: 0, message: event.message || "The world Worker failed" });
    });
    worker.addEventListener("messageerror", () => {
      this.#rejectAll({ code: "Internal", offset: 0, message: "A Worker message could not be deserialized" });
    });
  }

  /** Parses a `File` or transfers an `ArrayBuffer` (which detaches in the caller). Rejects with `WorldWorkerError`. */
  parse(input: File | ArrayBuffer, options?: { readonly signal?: AbortSignal }): Promise<WorldTilesResult> {
    const requestId = this.#nextRequestId++;
    const signal = options?.signal;
    if (this.#disposed) {
      return Promise.reject(new WorldWorkerError(requestId, cancelledFailure("The world Worker client is disposed")));
    }
    if (signal?.aborted === true) {
      return Promise.reject(new WorldWorkerError(requestId, cancelledFailure("The parse request was aborted")));
    }
    return new Promise<WorldTilesResult>((resolve, reject) => {
      const onAbort = (): void => {
        const pending = this.#settle(requestId);
        if (pending === undefined) return;
        this.#post({ type: "cancel", requestId });
        pending.reject(new WorldWorkerError(requestId, cancelledFailure("The parse request was aborted")));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#pending.set(requestId, {
        resolve,
        reject,
        detach: () => { signal?.removeEventListener("abort", onAbort); },
      });
      this.#post({ type: "parse", requestId, input }, input instanceof ArrayBuffer ? [input] : []);
    });
  }

  /** Rejects pending requests with `Cancelled`, terminates the Worker and releases its resources. */
  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#rejectAll(cancelledFailure("The world Worker client was disposed"));
    this.#worker.terminate();
  }

  #post(request: WorldWorkerRequest, transfer: Transferable[] = []): void {
    this.#worker.postMessage(request, transfer);
  }

  #settle(requestId: number): Pending | undefined {
    const pending = this.#pending.get(requestId);
    if (pending === undefined) return undefined;
    this.#pending.delete(requestId);
    pending.detach();
    return pending;
  }

  #rejectAll(failure: WorldWorkerFailure): void {
    for (const requestId of [...this.#pending.keys()]) {
      this.#settle(requestId)?.reject(new WorldWorkerError(requestId, failure));
    }
  }
}
