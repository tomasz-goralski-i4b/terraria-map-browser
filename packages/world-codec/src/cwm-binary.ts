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
export function serializeCwm(world: CwmBinaryWorld, schemaVersion = 1): Uint8Array<ArrayBuffer> {
  if (schemaVersion !== 1) throw new RangeError(`Unsupported CWM schema version: ${String(schemaVersion)}`);
  const { width, height } = world.metadata;
  const cells = width * height;
  const payloadLength = cells * 15;
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0
    || !Number.isSafeInteger(cells) || !Number.isSafeInteger(payloadLength)) {
    throw new RangeError(`Invalid CWM dimensions or payload size: ${String(width)} by ${String(height)}`);
  }
  for (const [name, elementType] of planeLayout) {
    const plane = world.planes[name];
    if (!(plane instanceof elementType) || plane.length !== cells) {
      throw new RangeError(`CWM ${name} must be a ${elementType.name} with ${String(cells)} elements`);
    }
  }
  const { metadata } = world;
  const json = JSON.stringify({
    schemaVersion,
    formatVersion: world.header.version,
    metadata: {
      name: metadata.name.toWellFormed(),
      seed: metadata.seed?.toWellFormed() ?? null,
      guid: metadata.guid?.toWellFormed() ?? null,
      worldId: metadata.worldId,
      gameMode: gameMode(metadata.mode),
      evil: metadata.evil,
    },
    dimensions: { width, height },
    palette: world.palette.map(headerReference),
  });
  const header = new TextEncoder().encode(json);
  const totalLength = 12 + header.length + payloadLength;
  if (header.length > 0xffffffff || !Number.isSafeInteger(totalLength)) {
    throw new RangeError("CWM header or total size exceeds binary framing limits");
  }
  const bytes = new Uint8Array(totalLength);
  const view = new DataView(bytes.buffer);
  bytes.set([0x43, 0x57, 0x4d, 0]);
  view.setUint32(4, schemaVersion, true);
  view.setUint32(8, header.length, true);
  bytes.set(header, 12);
  let offset = 12 + header.length;
  for (const [name] of planeLayout) {
    const plane = world.planes[name];
    if (plane instanceof Uint8Array) {
      bytes.set(plane, offset);
      offset += plane.length;
    } else {
      // DataView fixes endianness independently of the host and honors sliced plane views.
      for (const value of plane) {
        view.setUint16(offset, value, true);
        offset += 2;
      }
    }
  }
  return bytes;
}

const planeLayout = [
  ["block", Uint16Array], ["wall", Uint16Array], ["frameX", Int16Array], ["frameY", Int16Array],
  ["paint", Uint8Array], ["wallPaint", Uint8Array], ["liquid", Uint8Array],
  ["liquidAmount", Uint8Array], ["shape", Uint8Array], ["flags", Uint16Array],
] as const;

function gameMode(mode: WorldMode | null): number | null {
  if (mode === null) return null;
  if (typeof mode === "object") return mode.raw;
  return { classic: 0, expert: 1, master: 2, journey: 3 }[mode];
}

function headerReference(ref: CwmContentRef): CwmContentRef {
  if (ref.kind === "vanilla") return { kind: ref.kind, id: ref.id };
  if (ref.kind === "unknown") return { kind: ref.kind, runtimeId: ref.runtimeId };
  return {
    kind: ref.kind, mod: ref.mod.toWellFormed(), internalName: ref.internalName.toWellFormed(),
    ...(ref.runtimeId === undefined ? {} : { runtimeId: ref.runtimeId }),
    ...(ref.modVersion === undefined ? {} : { modVersion: ref.modVersion.toWellFormed() }),
  };
}
