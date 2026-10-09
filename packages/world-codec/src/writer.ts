import type { WorldTilesResult } from "./tiles.js";

export function writeWorldTiles(_world: Pick<WorldTilesResult, "metadata" | "sections" | "planes" | "palette">): Uint8Array {
  throw new Error("not implemented");
}

export function writeWorld(_world: WorldTilesResult): ArrayBuffer {
  throw new Error("not implemented");
}
