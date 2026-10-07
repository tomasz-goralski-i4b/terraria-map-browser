// The independent codec API; importing it requires no host globals.
export { ByteReader } from "./byte-reader.js";
export {
  isFrameImportant,
  readWorldHeader,
  type SectionBoundary,
  type WorldFileHeader,
  type WorldHeader,
  type WorldSectionTable,
} from "./header.js";
export { WorldFormatError, type WorldFormatErrorKind } from "./world-format-error.js";
export { readWorldMetadata, type WorldMetadata, type WorldMetadataResult, type WorldMode } from "./metadata.js";
export { readWorldTiles, type TileContentRef, type TilePlanes, type WorldTilesResult } from "./tiles.js";
