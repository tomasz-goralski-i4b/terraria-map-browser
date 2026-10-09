import type { WorldTilesResult } from "./tiles.js";
import type { WorldWorkerFailure, WorldWorkerRequest, WorldWorkerResponse } from "./worker-protocol.js";

/** A codec request failed in the Worker; carries the structured code/offset and the request ID. */
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
  readonly type: "parse" | "save";
  readonly resolve: (result: WorldTilesResult | ArrayBuffer) => void;
  readonly reject: (error: WorldWorkerError) => void;
  readonly detach: () => void;
}

function cancelledFailure(message: string): WorldWorkerFailure {
  return { code: "Cancelled", offset: 0, message };
}

/** Main-thread client of the world codec Worker; a failure never poisons the next parse or save. */
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
      if (response.type === "failed") pending.reject(new WorldWorkerError(response.requestId, response.error));
      else if (response.type === "parsed" && pending.type === "parse") pending.resolve(response.result);
      else if (response.type === "saved" && pending.type === "save") pending.resolve(response.output);
      else pending.reject(new WorldWorkerError(response.requestId, { code: "Internal", offset: 0, message: "Unexpected Worker response" }));
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
   * Creates a client that owns its Worker through `createWorker`: aborting an in-flight request terminates that
   * Worker (synchronous codec work cannot be interrupted) and continues on a fresh one.
   */
  static create(createWorker: () => Worker): WorldWorkerClient {
    return new WorldWorkerClient(createWorker);
  }

  /** Saves a structured clone of `world`; caller-owned planes and source remain attached and unchanged. */
  save(world: WorldTilesResult, options?: { readonly signal?: AbortSignal }): Promise<ArrayBuffer> {
    return this.#request<ArrayBuffer>({ type: "save", requestId: this.#nextRequestId++, world }, [], options);
  }

  /** Parses a `File` or transfers an `ArrayBuffer` (which detaches in the caller). Rejects with `WorldWorkerError`. */
  parse(input: File | ArrayBuffer, options?: { readonly signal?: AbortSignal }): Promise<WorldTilesResult> {
    return this.#request<WorldTilesResult>({ type: "parse", requestId: this.#nextRequestId++, input },
      input instanceof ArrayBuffer ? [input] : [], options);
  }

  #request<T extends WorldTilesResult | ArrayBuffer>(
    request: WorldWorkerRequest, transfer: Transferable[], options?: { readonly signal?: AbortSignal },
  ): Promise<T> {
    const { requestId } = request;
    const signal = options?.signal;
    if (this.#disposed) {
      return Promise.reject(new WorldWorkerError(requestId, cancelledFailure("The world Worker client is disposed")));
    }
    if (signal?.aborted === true) {
      return Promise.reject(new WorldWorkerError(requestId, cancelledFailure(`The ${request.type} request was aborted`)));
    }
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        const pending = this.#settle(requestId);
        if (pending === undefined) return;
        pending.reject(new WorldWorkerError(requestId, cancelledFailure(`The ${request.type} request was aborted`)));
        // Drop the busy Worker and every request on it; continue on a fresh Worker.
        this.#rejectAll(cancelledFailure("The world Worker was restarted after another request was aborted"));
        this.#worker.terminate();
        if (!this.#disposed) {
          this.#worker = this.#createWorker();
          this.#attach(this.#worker);
        }
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.#pending.set(requestId, {
        type: request.type,
        // Response type is checked against the request before this resolver is called.
        resolve: (result) => { resolve(result as T); },
        reject,
        detach: () => { signal?.removeEventListener("abort", onAbort); },
      });
      try {
        this.#post(request, transfer);
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
