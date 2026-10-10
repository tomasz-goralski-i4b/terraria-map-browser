// Reads Terraria content files from the user's own installation; requires no host globals.
export { XnbFormatError, type XnbErrorKind } from "./xnb-error.js";
export {
  DEFAULT_XNB_LIMITS,
  readXnbTexture,
  type XnbLimits,
  type XnbReadOptions,
  type XnbTexture,
} from "./xnb-texture.js";
export * from "./atlas-types.js";
export {
  ATLAS_FORMAT_VERSION,
  AtlasSheetTooLargeError,
  findSprite,
  packSheets,
  readSpritePixels,
  type PackOptions,
} from "./atlas-pack.js";
export {
  computeFingerprint,
  loadCachedAtlas,
  loadCachedMissing,
  storeAtlas,
  type CacheDirectory,
  type CacheFile,
  type FingerprintInput,
  type StoreOptions,
} from "./atlas-cache.js";
export {
  buildSpriteAtlas,
  isAtlasSheetName,
  type BuildOptions,
  type BuildPhase,
  type BuildProgress,
  type BuildResult,
  type ContentDirectory,
  type ContentEntry,
} from "./atlas-build.js";
export { filesToContentDirectory, type PickedFile } from "./content-files.js";
export type { AtlasWorkerRequest, AtlasWorkerResponse } from "./atlas-worker-protocol.js";
