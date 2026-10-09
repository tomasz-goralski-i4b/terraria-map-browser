import type { WorldMetadataResult } from "./metadata.js";
import type { SectionBoundary } from "./header.js";

const OPAQUE_SECTION_NAMES = [
  "chests", "signs", "npcsAndMobs", "tileEntities", "weightedPressurePlates", "townManager", "bestiary", "creativePowers",
] as const;

/** A named, uninterpreted section after the tile payload. */
export interface OpaqueWorldSection {
  readonly name: typeof OPAQUE_SECTION_NAMES[number];
  readonly bytes: Uint8Array;
  readonly boundary: SectionBoundary;
}

/** Original bytes and decoded values retained independently of later edits. */
export interface WorldEnvelope {
  /** Borrowed input view. Callers must keep its bytes unchanged until saving or discarding the result. */
  readonly source: Uint8Array;
  readonly fileHeader: Uint8Array;
  readonly metadata: Uint8Array;
  readonly tiles: Uint8Array;
  readonly opaqueSections: readonly OpaqueWorldSection[];
  readonly footer: Uint8Array;
  readonly frameImportantBits: Uint8Array;
  readonly original: Pick<WorldMetadataResult, "header" | "metadata" | "details">;
}

/** Called only after the header, metadata and tile parsers have validated their boundaries. */
export function preserveWorldEnvelope(bytes: Uint8Array, world: WorldMetadataResult): WorldEnvelope {
  const { sections } = world;
  const span = ({ start, end }: SectionBoundary): Uint8Array => bytes.subarray(start, end);
  return {
    source: bytes,
    fileHeader: span(sections.fileHeader),
    metadata: span(sections.metadata),
    tiles: span(sections.tiles),
    opaqueSections: OPAQUE_SECTION_NAMES.map((name) => ({
      name,
      bytes: span(sections[name]),
      boundary: { ...sections[name] },
    })),
    footer: span(sections.footer),
    frameImportantBits: sections.frameImportantBits,
    original: structuredClone({ header: world.header, metadata: world.metadata, details: world.details }),
  };
}
