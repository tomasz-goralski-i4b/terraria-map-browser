import type { WorldHeader } from "./header.js";

export type WorldMode = "classic" | "expert" | "master" | "journey" | { mode: "unknown"; raw: number };

/** Validated format-326 metadata, before any tile planes are allocated. */
export interface WorldMetadata {
  readonly name: string;
  readonly seed: string;
  readonly guid: string;
  readonly worldId: number;
  readonly width: number;
  readonly height: number;
  readonly mode: WorldMode;
  readonly evil: "corruption" | "crimson";
}

export interface WorldMetadataResult extends WorldHeader {
  readonly metadata: WorldMetadata;
}

/** Reads the validated header and all metadata fields, bounded by pointer[1]. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- RED keeps the input signature without implementing parsing.
export function readWorldMetadata(_bytes: Uint8Array): WorldMetadataResult {
  throw new Error("not implemented");
}
