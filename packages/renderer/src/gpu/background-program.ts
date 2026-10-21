/// <reference lib="dom" />

import { finishLink, parallelShaderCompile, startLink, type GpuPart, type Linking, type Program, type ProgramSource } from "./gl.js";

/** How often a program linked in the background is asked whether it is done. */
const LINK_POLL_MILLISECONDS = 50;

/**
 * A program linked in the background where the browser offers KHR_parallel_shader_compile (it takes seconds on some
 * drivers, D3D11 with a cold shader cache), at once where it does not.
 */
export interface BackgroundProgram<Name extends string> extends GpuPart {
  /**
   * The program, linking it if needed. Null while the driver still links it and `wait` is false; with `wait` it waits
   * for the link. A failed link is thrown with `wait` and returns null without.
   */
  readonly get: (wait: boolean) => Program<Name> | null;
  /** Starts linking unless the program is linked, being linked, or failed. */
  readonly start: () => void;
  /** Whether a background link is running. */
  readonly preparing: () => boolean;
  /** Whether the program is linked, without starting a link. */
  readonly linked: () => boolean;
  /** The context was lost: a background link died with it (no GL call needed to forget it). */
  readonly abort: () => void;
}

export function createBackgroundProgram<Name extends string>(
  gl: WebGL2RenderingContext, source: ProgramSource<Name>,
  /** Called with true when a background link starts and with false when it ends, however it ends. */
  onPreparing: ((preparing: boolean) => void) | undefined,
  /** Called once a background link has ended (linked or failed), to draw with the result. */
  onSettled: () => void,
): BackgroundProgram<Name> {
  let program: Program<Name> | null = null;
  let linking: Linking | null = null;
  // Why the program failed to link, for this context.
  let failure: Error | null = null;
  let parallel = parallelShaderCompile(gl);
  // The timer that asks whether the background link is done; 0 when none is pending.
  let poll = 0;
  let released = false;

  const done = (): boolean => linking === null || parallel === null
    || (gl.getProgramParameter(linking.program, parallel.COMPLETION_STATUS_KHR) as boolean);

  /** Forgets the pending link and its poll; reports the end of a background one. */
  const end = (): void => {
    const pending = linking !== null;
    linking = null;
    window.clearTimeout(poll);
    poll = 0;
    if (pending && parallel !== null) onPreparing?.(false);
  };

  /**
   * Waits for the link (if it is still running) and keeps the program; a failure is kept and thrown. Either way the
   * link has ended.
   */
  const finish = (): Program<Name> => {
    if (program !== null) return program;
    if (linking === null) throw new Error("the program is not being linked");
    try {
      program = finishLink(gl, linking, source.uniforms);
      return program;
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
      throw failure;
    } finally {
      end();
    }
  };

  const start = (): void => {
    if (program !== null || linking !== null || failure !== null) return;
    linking = startLink(gl, source.vertex, source.fragment);
    if (parallel === null) {
      finish();
      return;
    }
    onPreparing?.(true);
    const check = (): void => {
      poll = 0;
      if (linking === null || released || gl.isContextLost()) return;
      if (!done()) {
        poll = window.setTimeout(check, LINK_POLL_MILLISECONDS);
        return;
      }
      try {
        finish();
      } catch {
        // Kept in `failure`: `get(false)` returns null and `get(true)` throws it.
      }
      onSettled();
    };
    poll = window.setTimeout(check, LINK_POLL_MILLISECONDS);
  };

  return {
    get: (wait) => {
      if (program !== null) return program;
      if (failure !== null) {
        if (wait) throw failure;
        return null;
      }
      // Without KHR_parallel_shader_compile this links it at once (finish then returns it).
      start();
      return wait || done() ? finish() : null;
    },
    start,
    preparing: () => linking !== null,
    linked: () => program !== null,
    abort: end,
    lost: () => {
      end();
      program = null;
      failure = null;
      parallel = parallelShaderCompile(gl);
    },
    release: () => {
      released = true;
      if (!gl.isContextLost()) {
        if (program !== null) gl.deleteProgram(program.program);
        if (linking !== null) gl.deleteProgram(linking.program);
      }
      end();
      program = null;
    },
  };
}
