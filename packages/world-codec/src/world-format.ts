import { WorldFormatError } from "./world-format-error.js";

// Independently stated version gates: docs/file-format/compatibility.md.
// Sources T1/T11/T29/T32/T34 at TEdit revision 182031b83ce825719f857a6db4ecb6967118abd3.
// Highest vanilla block/wall ids: T41 (Data/versions.json:753-962), equal within each range below.
const releasedRanges = [
  { first: 269, last: 279, family: "terraria-1.4.4", maxTileId: 692, maxWallId: 346 },
  { first: 315, last: 319, family: "terraria-1.4.5", maxTileId: 752, maxWallId: 366 },
  { first: 325, last: 326, family: "terraria-1.4.5", maxTileId: 753, maxWallId: 366 },
] as const;

/** Admission is separate from structural feature gates: unreleased gaps are never inferred compatible. */
export const SUPPORTED_VANILLA_FORMATS: readonly number[] = Object.freeze(releasedRanges.flatMap((range) =>
  Array.from({ length: range.last - range.first + 1 }, (_, index) => range.first + index),
));

const metadataSince = {
  lastPlayed: 284,
  permanentHolidays: 287,
  vampireSeed: 288,
  claimableBanners: 289,
  eventCounts: 291,
  infectedSeed: 296,
  teamSpawns: 297,
  worldGenManifest: 299,
  skyblockSeed: 302,
  dualDungeonsSeed: 304,
  lightningSeeds: 323,
} as const;

export type WorldMetadataFeature = keyof typeof metadataSince;
export type WorldMetadataFeatures = Readonly<Record<WorldMetadataFeature, boolean>>;

export interface WorldFormatProfile {
  readonly version: number;
  readonly family: "terraria-1.4.4" | "terraria-1.4.5";
  /** Evidence for this implementation, not a promise about every world produced by that game. */
  readonly evidence: "generated-world-fixtures" | "synthetic";
  readonly sectionCount: 11;
  readonly tileEncoding: "four-header-byte-rle";
  /** Highest block id the game of this format defines; higher ids are not vanilla content. */
  readonly maxTileId: number;
  /** Highest wall id the game of this format defines; higher ids are not vanilla content. */
  readonly maxWallId: number;
  readonly metadata: WorldMetadataFeatures;
  /** Describes entity layouts; entity sections are still opaque to the TS viewer. */
  readonly entities: {
    readonly chestSlotCounts: "shared-int16" | "per-chest-int32";
    readonly npcHomelessDespawn: boolean;
    readonly displayDollPose: boolean;
    readonly displayDollExtraSlots: boolean;
  };
}

/** Resolves admitted released formats to a shared layout profile; returns null for all other inputs. */
export function resolveWorldFormat(version: number): WorldFormatProfile | null {
  if (!Number.isInteger(version)) return null;
  const range = releasedRanges.find((candidate) => version >= candidate.first && version <= candidate.last);
  if (range === undefined) return null;
  const metadata = {} as Record<WorldMetadataFeature, boolean>;
  for (const [name, since] of Object.entries(metadataSince)) {
    metadata[name as WorldMetadataFeature] = version >= since;
  }
  return Object.freeze({
    version,
    family: range.family,
    evidence: version === 326 ? "generated-world-fixtures" : "synthetic",
    sectionCount: 11,
    tileEncoding: "four-header-byte-rle",
    maxTileId: range.maxTileId,
    maxWallId: range.maxWallId,
    metadata: Object.freeze(metadata),
    entities: Object.freeze({
      chestSlotCounts: version >= 294 ? "per-chest-int32" : "shared-int16",
      npcHomelessDespawn: version >= 315,
      displayDollPose: version >= 307,
      displayDollExtraSlots: version >= 308,
    }),
  });
}

/** Internal parser seam: preserve the existing structured rejection and check order. */
export function requireWorldFormat(version: number): WorldFormatProfile {
  const profile = resolveWorldFormat(version);
  if (profile === null) {
    throw new WorldFormatError("UnsupportedVersion", 0, `format version ${String(version)} is not supported`);
  }
  return profile;
}
