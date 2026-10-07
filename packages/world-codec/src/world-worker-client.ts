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
  #worker: Worker;
  readonly #createWorker: () => Worker;
  readonly #pending = new Map<number, Pending>();
  #nextRequestId = 1;
  #disposed = false;

  private constructor(createWorker: () => Worker) {
    this.#createWorker = createWorker;
    this.#worker = createWorker();
    this.#attach(this.#worker);
  }

  #attach(worker: Worker): void {
    worker.addEventListener("message", (event: MessageEvent<WorldWorkerResponse>) => {
      if (worker !== this.#worker) return;
      const response = event.data;
      const pending = this.#settle(response.requestId);
      if (pending === undefined) return;
      if (response.type === "parsed") pending.resolve(response.result);
      else pending.reject(new WorldWorkerError(response.requestId, response.error));
    });
    worker.addEventListener("error", (event) => {
      if (worker !== this.#worker) return;
      this.#rejectAll({ code: "Internal", offset: 0, message: event.message || "The world Worker failed" });
    });
    worker.addEventListener("messageerror", () => {
      if (worker !== this.#worker) return;
      this.#rejectAll({ code: "Internal", offset: 0, message: "A Worker message could not be deserialized" });
    });
  }

  /**
   * Creates a client that owns its Worker through `createWorker`: aborting an in-flight parse terminates that
   * Worker (a decode cannot be interrupted) and continues on a fresh one. This is the only construction mode.
   */
  static create(createWorker: () => Worker): WorldWorkerClient {
    return new WorldWorkerClient(createWorker);
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
        pending.reject(new WorldWorkerError(requestId, cancelledFailure("The parse request was aborted")));
        // A running decode cannot be interrupted: drop the busy Worker (and every request on it), continue on a new one.
        this.#rejectAll(cancelledFailure("The world Worker was restarted after another request was aborted"));
        this.#worker.terminate();
        if (!this.#disposed) {
          this.#worker = this.#createWorker();
          this.#attach(this.#worker);
        }
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#pending.set(requestId, {
        resolve,
        reject,
        detach: () => { signal?.removeEventListener("abort", onAbort); },
      });
      try {
        this.#post({ type: "parse", requestId, input }, input instanceof ArrayBuffer ? [input] : []);
      } catch (error) {
        // e.g. DataCloneError for an already-detached ArrayBuffer: settle so nothing stays registered.
        this.#settle(requestId);
        reject(new WorldWorkerError(requestId, {
          code: "Internal",
          offset: 0,
          message: error instanceof Error ? error.message : String(error),
        }));
      }
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
