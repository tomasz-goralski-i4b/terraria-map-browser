import type { WorldMetadata, WorldMode } from "./metadata.js";
import type { TileContentRef, TilePlanes } from "./tiles.js";

export type CwmContentRef = TileContentRef | {
  readonly kind: "mod";
  readonly mod: string;
  readonly internalName: string;
  readonly runtimeId?: number;
  readonly modVersion?: string;
};

/** Structural input: existing parsed planes, never a second tile grid. */
export interface CwmBinaryWorld {
  readonly header: { readonly version: number };
  readonly metadata: Pick<WorldMetadata, "name" | "worldId" | "evil" | "width" | "height"> & {
    readonly seed: string | null;
    readonly guid: string | null;
    readonly mode: WorldMode | null;
  };
  readonly palette: readonly CwmContentRef[];
  readonly planes: TilePlanes;
}

/** Deterministic CWM v1 bytes, as specified in docs/cwm.md. */
export function serializeCwm(_world: CwmBinaryWorld, _schemaVersion = 1): Uint8Array {
  throw new Error("not implemented");
}
