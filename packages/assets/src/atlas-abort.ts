/** Throws an `AbortError` `DOMException` when `signal` has aborted. */
export function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted === true) throw new DOMException("The atlas build was cancelled.", "AbortError");
}
