import type { WorldTilesResult } from "@studio/world-codec";

/** Small display facts about the loaded world; the planes and palette themselves stay outside React and the store. */
export interface WorldSummary {
  readonly name: string;
  readonly width: number;
  readonly height: number;
  readonly seed: string;
  readonly mode: string;
  readonly evil: "corruption" | "crimson";
  readonly formatVersion: number;
  readonly paletteSize: number;
}

/** The slice of `WorldWorkerClient` the session needs. */
export interface WorldParser {
  parse(input: File, options?: { readonly signal?: AbortSignal }): Promise<WorldTilesResult>;
}

export interface WorldSession {
  /** Parses `file` in the Worker; a failure or cancel keeps the previous world. */
  readonly open: (file: File) => Promise<void>;
  /** Cancels a parse in progress and returns to the previous state. */
  readonly cancel: () => void;
  /** The loaded world (planes, palette, metadata) as a plain reference, not React state. */
  readonly getLoadedWorld: () => WorldTilesResult | null;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub until the green phase
export function createWorldSession(_parser: WorldParser): WorldSession {
  throw new Error("not implemented");
}

/** The session used by the app: backed by a real world-parsing Worker. */
export function getDefaultWorldSession(): WorldSession {
  throw new Error("not implemented");
}
