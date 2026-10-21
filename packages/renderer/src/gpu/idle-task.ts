/// <reference lib="dom" />

/** Work run in the browser's idle periods, one step per request; at most one step is pending. */
export interface IdleTask {
  /** Asks for a step unless one is pending. */
  readonly schedule: () => void;
  readonly cancel: () => void;
}

/**
 * `step` runs in an idle period (requestIdleCallback, at the latest after `timeout` ms), or after `fallbackDelay` ms
 * with a null deadline where the browser has no idle callbacks.
 */
export function createIdleTask(step: (deadline: IdleDeadline | null) => void, timeout: number, fallbackDelay: number): IdleTask {
  const idle = typeof requestIdleCallback === "function";
  // The pending request; 0 when none is pending.
  let handle = 0;
  return {
    schedule: () => {
      if (handle !== 0) return;
      handle = idle
        ? requestIdleCallback((deadline) => { handle = 0; step(deadline); }, { timeout })
        : globalThis.setTimeout(() => { handle = 0; step(null); }, fallbackDelay);
    },
    cancel: () => {
      if (handle === 0) return;
      if (idle) cancelIdleCallback(handle);
      else clearTimeout(handle);
      handle = 0;
    },
  };
}
