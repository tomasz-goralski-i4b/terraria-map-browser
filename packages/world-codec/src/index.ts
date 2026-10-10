// The independent codec API; importing it requires no host globals.
export { serializeCwm, type CwmBinaryWorld, type CwmContentRef } from "./cwm-binary.js";
export { ByteReader } from "./byte-reader.js";
export {
  resolveWorldFormat, SUPPORTED_VANILLA_FORMATS,
  type WorldFormatProfile, type WorldMetadataFeature, type WorldMetadataFeatures,
} from "./world-format.js";
export {
  isFrameImportant,
  readWorldHeader,
  type SectionBoundary,
  type WorldFileHeader,
  type WorldHeader,
  type WorldSectionTable,
} from "./header.js";
export { WorldFormatError, type WorldFormatErrorKind } from "./world-format-error.js";
export { readWorldMetadata, type WorldBounds, type WorldMetadata, type WorldMetadataResult, type WorldMode } from "./metadata.js";
export { type WorldDetails, type WorldPoint } from "./details.js";
export {
  readEntitySection, readWorldEntities, readTileEntityPayloads, type TileEntityPayload,
  type EntityItem, type WorldChest, type WorldSign, type WorldTownNpc, type WorldMob,
  type WorldTileEntity, type WorldPressurePlate, type WorldRoom, type WorldCreativePower,
  type EntityDataBySection, type EntitySectionName, type EntitySectionFailure, type EntitySectionResult, type WorldEntities,
} from "./entities.js";
export { readWorldTiles, type TileContentRef, type TilePlanes, type WorldTilesResult } from "./tiles.js";
export { type WorldEnvelope, type OpaqueWorldSection } from "./envelope.js";
export { collectTransferList, type WorldWorkerFailure, type WorldWorkerRequest, type WorldWorkerResponse } from "./worker-protocol.js";
export { WorldWorkerClient, WorldWorkerError } from "./world-worker-client.js";
export { writeWorld, writeWorldTiles } from "./writer.js";
export { writeWorldMetadata, normalizeWorldMetadata } from "./metadata-writer.js";
