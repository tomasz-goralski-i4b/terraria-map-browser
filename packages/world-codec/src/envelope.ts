import type { WorldMetadataResult } from "./metadata.js";
import type { SectionBoundary } from "./header.js";

/** Original bytes and decoded values retained independently of later edits. */
export interface WorldEnvelope {
  readonly source: Uint8Array;
  readonly fileHeader: Uint8Array;
  readonly metadata: Uint8Array;
  readonly tiles: Uint8Array;
  readonly opaqueSections: readonly { readonly name: string; readonly bytes: Uint8Array; readonly boundary: SectionBoundary }[];
  readonly footer: Uint8Array;
  readonly frameImportantBits: Uint8Array;
  readonly original: Pick<WorldMetadataResult, "header" | "metadata" | "details">;
}

export function preserveWorldEnvelope(_bytes: Uint8Array, _world: WorldMetadataResult): WorldEnvelope {
  throw new Error("not implemented");
}
