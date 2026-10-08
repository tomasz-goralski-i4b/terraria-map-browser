/** Synthetic format-279/326 metadata, independently generated from docs/file-format/metadata.md rows 1–59.
 * Test support only; never exported from the package API.
 */
export interface MetadataSpec {
  version?: 279 | 326;
  allSpecialSeeds?: boolean;
  name?: string;
  seed?: string;
  manifest?: string;
  finisher?: string;
  width?: number;
  height?: number;
  mode?: number;
  crimson?: number;
  worldId?: number;
  worldGenVersion?: bigint;
  creationTime?: bigint;
  lastPlayed?: bigint;
  surfaceLevel?: number;
  rockLevel?: number;
}

/** UTF-8 generation for synthetic strings without depending on browser or Node globals. */
function encodeUtf8(value: string): number[] {
  const bytes: number[] = [];
  for (const character of value) {
    const point = character.codePointAt(0) ?? 0;
    if (point < 0x80) bytes.push(point);
    else if (point < 0x800) bytes.push(0xc0 | (point >> 6), 0x80 | (point & 63));
    else if (point < 0x10000) bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 63), 0x80 | (point & 63));
    else bytes.push(0xf0 | (point >> 18), 0x80 | ((point >> 12) & 63), 0x80 | ((point >> 6) & 63), 0x80 | (point & 63));
  }
  return bytes;
}

export function buildMetadata(spec: MetadataSpec = {}): {
  bytes: Uint8Array;
  offsets: Readonly<Record<string, number>>;
  booleans: readonly number[];
} {
  const data: number[] = [];
  const offsets: Record<string, number> = {};
  const booleans: number[] = [];
  const mark = (name: string): void => { offsets[name] = data.length; };
  const number = (size: number, value: number, floating = false): void => {
    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);
    if (floating && size === 8) view.setFloat64(0, value, true);
    else if (floating) view.setFloat32(0, value, true);
    else if (size === 4) view.setInt32(0, value, true);
    else if (size === 2) view.setInt16(0, value, true);
    else view.setUint8(0, value);
    data.push(...bytes);
  };
  const int = (value: number): void => { number(4, value); };
  const long = (value: bigint): void => {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setBigUint64(0, BigInt.asUintN(64, value), true);
    data.push(...bytes);
  };
  const string = (field: string, value: string): void => {
    mark(field);
    const bytes = encodeUtf8(value);
    let length = bytes.length;
    do {
      const next = length % 128;
      length = Math.floor(length / 128);
      data.push(next | (length > 0 ? 128 : 0));
    } while (length > 0);
    for (const byte of bytes) data.push(byte);
  };
  let counter = 0;
  const bools = (count: number): void => {
    for (let index = 0; index < count; index++) {
      booleans.push(data.length);
      data.push(counter++ % 2);
    }
  };
  const ints = (count: number): void => {
    for (let index = 0; index < count; index++) int(0x01010000 + counter++);
  };
  const bytes = (count: number): void => {
    for (let index = 0; index < count; index++) data.push(0x40 + counter++ % 64);
  };
  const width = spec.width ?? 2;
  const height = spec.height ?? 4;
  const version = spec.version ?? 326;
  string("name", spec.name ?? "SCCR1");
  string("seed", spec.seed ?? "948580918");
  mark("worldGenVersion"); long(spec.worldGenVersion ?? 0x0000014600000001n);
  mark("guid");
  data.push(...Uint8Array.from("87e466e7853c3f48b75abc85e36d4b86".match(/../g) ?? [], (pair) => parseInt(pair, 16)));
  mark("worldId"); int(spec.worldId ?? 1743427911);
  int(0); int(16 * width); int(0); int(16 * height);
  mark("height"); int(height);
  mark("width"); int(width);
  mark("gameMode"); int(spec.mode ?? 0);
  const seedCount = version === 279 ? 8 : 9;
  if (spec.allSpecialSeeds === undefined) bools(seedCount);
  else for (let index = 0; index < seedCount; index++) { booleans.push(data.length); data.push(Number(spec.allSpecialSeeds)); }
  mark("creationTime"); long(spec.creationTime ?? 638000000000000001n);
  if (version === 326) { mark("lastPlayed"); long(spec.lastPlayed ?? 638000000100000001n); }
  bytes(1); ints(17); ints(2);
  mark("surfaceLevel"); number(8, spec.surfaceLevel ?? 300, true);
  mark("rockLevel"); number(8, spec.rockLevel ?? 420.5, true);
  number(8, 13500.25, true);
  mark("dayTime"); bools(1); ints(1); bools(2); ints(2);
  mark("crimson"); booleans.push(data.length); data.push(spec.crimson ?? 0);
  bools(18); bools(2); bytes(1); ints(1); bools(2); ints(3);
  number(8, -1.5, true); number(8, 2.25, true); bytes(1);
  bools(1); ints(1); number(4, 0.75, true); ints(3); bytes(8); ints(1);
  number(2, 291); number(4, -0.5, true);
  mark("anglerFinishers"); int(2);
  string("anglerFinisher0", spec.finisher ?? "Ålice"); string("anglerFinisher1", "Guide Andrew");
  bools(1); ints(1); bools(3); ints(2);
  mark("killCounts"); number(2, 3); int(21); int(400); int(17);
  if (version === 326) { mark("claimableBanners"); number(2, 2); number(2, 50); number(2, 200); }
  bools(19); bools(2); ints(1);
  mark("partyingNpcs"); int(3); int(17); int(18); int(19);
  bools(1); ints(1); number(4, 0.125, true); number(4, 0.25, true);
  bools(4); bytes(5); bools(1); ints(1); bools(3);
  mark("treeTopVariations"); int(13);
  for (let index = 0; index < 13; index++) int(index);
  bools(2); ints(4); bools(3); bools(12); bools(9); bools(1); bytes(1);
  if (version === 279) return { bytes: Uint8Array.from(data), offsets, booleans };
  bools(2); bools(2); ints(2); bools(1);
  mark("teamSpawns"); number(1, 2);
  number(2, 10); number(2, 20); number(2, -1); number(2, 32767);
  bools(1); bools(2);
  string("worldGenManifest", spec.manifest ?? '{"passes":["Terrain","Caves","Corruption"]}');
  return { bytes: Uint8Array.from(data), offsets, booleans };
}

export const METADATA_START = 167;

/** Full header and opaque later sections; tile contents deliberately are not decoded by these tests. */
export function wrapMetadata(metadata: Uint8Array, tileLength = 2, version: 279 | 326 = 326): Uint8Array {
  const metadataStart = version === 279 ? 159 : METADATA_START;
  const pointers = [metadataStart, metadataStart + metadata.length, metadataStart + metadata.length + tileLength];
  for (let index = 3; index < 11; index++) pointers.push((pointers[index - 1] ?? 0) + 2);
  const bytes = new Uint8Array((pointers[10] ?? 0) + 6);
  const view = new DataView(bytes.buffer);
  view.setInt32(0, version, true);
  bytes.set([0x72, 0x65, 0x6c, 0x6f, 0x67, 0x69, 0x63], 4);
  bytes[11] = 2;
  view.setUint32(12, 1, true);
  view.setInt16(24, 11, true);
  pointers.forEach((pointer, index) => { view.setInt32(26 + index * 4, pointer, true); });
  view.setInt16(70, version === 279 ? 693 : 754, true);
  bytes[72] = 0x30;
  bytes.set(metadata, metadataStart);
  bytes.fill(0xa5, pointers[1]);
  return bytes;
}
