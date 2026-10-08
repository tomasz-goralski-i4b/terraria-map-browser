import { closeSync, openSync, writeSync } from "node:fs";

export type WorkloadProfile = "sky-stone" | "dense" | "mixed";

export interface SyntheticWorldOptions {
  readonly seed: number;
  readonly profile?: WorkloadProfile;
  readonly width?: number;
  readonly height?: number;
}

interface Workload {
  readonly seed: number;
  readonly profile: WorkloadProfile;
  readonly width: number;
  readonly height: number;
}

const HEADER_LENGTH = 167; // 72 + ceil(754 / 8), docs/file-format/header.md.

function validate(options: SyntheticWorldOptions): Workload {
  const { seed, profile = "mixed", width = 8400, height = 2400 } = options;
  if (!Number.isInteger(seed) || seed < 0 || seed > 0xffffffff) throw new RangeError("seed must be a UInt32");
  if (!["sky-stone", "dense", "mixed"].includes(profile)) throw new RangeError("unknown workload profile");
  if (![width, height].every((side) => Number.isInteger(side) && side > 0 && side <= 65536) ||
      width * height > 2 ** 28) throw new RangeError("dimensions exceed the codec safety limits");
  const denseColumns = profile === "sky-stone" ? 0 : profile === "dense" ? width : Math.floor(width / 2);
  // Conservative upper bound: 15 bytes per dense record, at most four RLE records per sparse column.
  if (denseColumns * height * 15 + (width - denseColumns) * 16 + 4096 >= 2 ** 31) {
    throw new RangeError("workload exceeds signed Int32 section pointers");
  }
  return { seed, profile, width, height };
}

/** Fixed-size buffer shared across all records; the sink must consume or copy each view immediately. */
class BinaryEmitter {
  private readonly buffer = new Uint8Array(65536);
  private readonly scratch = new DataView(new ArrayBuffer(8));
  private used = 0;
  length = 0;
  private readonly sink: (bytes: Uint8Array) => void;

  constructor(sink: (bytes: Uint8Array) => void) { this.sink = sink; }

  u8(value: number): void {
    if (this.used === this.buffer.length) this.flush();
    this.buffer[this.used++] = value;
    this.length++;
  }

  u16(value: number): void { this.u8(value); this.u8(value >>> 8); }
  i32(value: number): void { this.u16(value); this.u16(value >>> 16); }
  zeros(count: number): void { for (let i = 0; i < count; i++) this.u8(0); }
  bytes(bytes: Uint8Array): void { for (const byte of bytes) this.u8(byte); }

  f64(value: number): void {
    this.scratch.setFloat64(0, value, true);
    this.bytes(new Uint8Array(this.scratch.buffer));
  }

  u64(value: bigint): void {
    this.scratch.setBigUint64(0, value, true);
    this.bytes(new Uint8Array(this.scratch.buffer));
  }

  string(value: string): void {
    const bytes = Buffer.from(value, "utf8");
    let length = bytes.length;
    while (length >= 128) { this.u8((length & 127) | 128); length >>>= 7; }
    this.u8(length);
    this.bytes(bytes);
  }

  flush(): void {
    if (this.used > 0) this.sink(this.buffer.subarray(0, this.used));
    this.used = 0;
  }
}

/** Straight format-326 sequence, independently encoded from docs/file-format/metadata.md rows 1–59. */
function metadata(out: BinaryEmitter, world: Workload, name: string): void {
  const { seed, width, height } = world;
  const surface = Math.min(height, Math.floor(height / 3) + seed % 3);
  out.string(name); out.string(String(seed)); out.u64(0n); // 1–3
  for (let part = 0; part < 4; part++) out.i32((seed + part) >>> 0); // 4: synthetic GUID, file order
  out.i32(seed); // 5: seed reinterpreted as signed Int32 world id
  out.i32(0); out.i32(width * 16); out.i32(0); out.i32(height * 16); // 6–9
  out.i32(height); out.i32(width); out.i32(0); // 10–12: classic
  out.zeros(9); // 13: special seeds
  const fixedDate = (BigInt(Date.UTC(2026, 0, 1)) * 10000n + 621355968000000000n) | (1n << 62n);
  out.u64(fixedDate); out.u64(fixedDate); out.u8(0); // 14–16: fixed UTC dates and moon type
  out.zeros(17 * 4); // 17: styles and boundaries
  out.i32(Math.floor(width / 2)); out.i32(Math.min(height - 1, surface)); // 18: spawn
  out.f64(surface); out.f64(Math.floor(height * 2 / 3)); out.f64(0); // 19
  out.u8(1); out.i32(0); out.zeros(2); // 20: daytime, moon, blood moon, eclipse
  out.i32(0); out.i32(Math.min(height - 1, surface)); out.u8(0); // 21–22: dungeon, corruption
  out.zeros(10 + 1 + 7); // 23–25: bosses, King Slime, saved NPCs / invasions
  out.zeros(8); out.u8(0); // 26–27: orbs, meteor, altar count, hardmode, party of doom
  out.zeros(20); out.f64(0); out.u8(0); // 28–30: invasion, slime rain, sundial
  out.zeros(1 + 4 + 4); // 31: rain
  out.i32(107); out.i32(108); out.i32(111); // hardmode ore tiers
  out.zeros(8 + 4 + 2 + 4); // backgrounds, cloud background, count, wind
  out.i32(0); // 32: no angler finishers
  out.zeros(16); // 33: saved NPCs, quest, invasion start size, cultist delay
  out.u16(0); out.u16(0); out.u8(0); // 34–36: kill/banner lists, fast-forward
  out.zeros(9); out.zeros(9); // 37–38: bosses and pillars
  out.zeros(10); out.zeros(13); out.zeros(4); // 39–41: party, sandstorm, Old One's Army
  out.zeros(5); out.u8(0); out.zeros(7); out.i32(0); // 42–45: backgrounds, book, lanterns, tree list
  out.zeros(2); // 46: holidays today
  out.i32(7); out.i32(6); out.i32(9); out.i32(8); // 47: pre-hardmode ore tiers
  out.zeros(3); out.zeros(12); out.zeros(9); // 48–50: pets, bosses/unlocks, books/slimes
  out.zeros(2); out.zeros(2); out.zeros(2); // 51–53: dusk/moondial, holidays forever, seeds
  out.zeros(8); out.zeros(2); out.u8(0); out.zeros(2); // 54–57: events, team spawn list, seeds
  // Row 58 is absent in format 326.
  out.string("{}"); // 59: synthetic manifest
}

/** Emit a homogeneous range, splitting counters at Int16's positive maximum, never at a column boundary. */
function run(out: BinaryEmitter, block: boolean, length: number): void {
  for (let remaining = length; remaining > 0;) {
    const cells = Math.min(remaining, 32768);
    const repeats = cells - 1;
    const counterFlag = repeats === 0 ? 0 : repeats <= 255 ? 0x40 : 0x80;
    out.u8((block ? 2 : 0) | counterFlag);
    if (block) out.u8(1); // Stone, not frame-important in our synthetic header.
    if (repeats > 255) out.u16(repeats);
    else if (repeats > 0) out.u8(repeats);
    remaining -= cells;
  }
}

/** No Tile objects, palette or grid: only coordinate-derived scalar payloads. */
function tiles(out: BinaryEmitter, world: Workload): void {
  const { seed, profile, width, height } = world;
  for (let x = 0; x < width; x++) {
    if (profile === "sky-stone" || (profile === "mixed" && x % 2 === 0)) {
      const sky = Math.min(height, Math.floor(height / 3) + seed % 3);
      run(out, false, sky);
      run(out, true, height - sky);
      continue;
    }
    for (let y = 0; y < height; y++) {
      const phase = (seed + 17 * x + 31 * y) >>> 0;
      const block = (phase & 1) === 0 ? 4 : 300;
      const liquid = 1 + phase % 4;
      const coatings = 1 + phase % 15;
      const flag1 = 1 | 2 | 4 | (block > 255 ? 0x20 : 0) | ((liquid === 4 ? 1 : liquid) << 3);
      const flag2 = 1 | ((phase & 7) << 1) | ((phase % 6) << 4);
      const flag3 = 1 | 8 | 16 | 64 | ((phase & 8) << 2) |
        ((phase & 16) >> 3) | ((phase & 32) >> 3) | (liquid === 4 ? 128 : 0);
      out.u8(flag1); out.u8(flag2); out.u8(flag3); out.u8(coatings << 1);
      if (block > 255) out.u16(block); else out.u8(block);
      out.u16(18 * (x % 32)); out.u16(18 * (y % 16));
      out.u8(1 + phase % 30); // block paint
      out.u8(300 & 255); out.u8(1 + (phase >>> 5) % 30); // wall low byte, wall paint
      out.u8(1 + phase % 255); out.u8(300 >>> 8); // liquid amount BEFORE wall high byte
    }
  }
}

function encode(world: Workload, sink: (bytes: Uint8Array) => void): { header: Uint8Array; length: number } {
  const out = new BinaryEmitter(sink);
  out.zeros(HEADER_LENGTH);
  const pointers = [out.length];
  const name = `Synthetic-${world.profile}-${String(world.seed)}`;
  metadata(out, world, name); pointers.push(out.length);
  tiles(out, world); pointers.push(out.length);
  // Empty section encodings from docs/file-format/entities.md, not opaque padding.
  for (const length of [2, 2, 6, 4, 4, 4, 12, 1]) { out.zeros(length); pointers.push(out.length); }
  out.u8(1); out.string(name); out.i32(world.seed); // matching footer
  out.flush();

  const header = new Uint8Array(HEADER_LENGTH);
  const view = new DataView(header.buffer);
  view.setInt32(0, 326, true);
  header.set(Buffer.from("relogic", "ascii"), 4);
  header[11] = 2;
  view.setUint32(12, 1, true);
  view.setInt16(24, 11, true);
  pointers.forEach((pointer, index) => { view.setInt32(26 + 4 * index, pointer, true); });
  view.setInt16(70, 754, true);
  // These are deliberately synthetic frame claims, not a copied vanilla framing table.
  for (const id of [4, 300]) header[72 + (id >> 3)] = 1 << (id & 7);
  return { header, length: out.length };
}

/** Convenient small-case API; use writeSyntheticWorld for Large workloads. */
export function generateSyntheticWorld(options: SyntheticWorldOptions): Uint8Array {
  const world = validate(options);
  const chunks: Uint8Array[] = [];
  const { header, length } = encode(world, (bytes) => { chunks.push(bytes.slice()); });
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; }
  result.set(header);
  return result;
}

function writeAll(fd: number, bytes: Uint8Array, position: number): void {
  let written = 0;
  while (written < bytes.length) {
    const count = writeSync(fd, bytes, written, bytes.length - written, position + written);
    if (count === 0) throw new Error("world output made no progress");
    written += count;
  }
}

/** Streaming file API, exclusive creation; caller owns cleanup of temporary output on errors. */
export function writeSyntheticWorld(path: string, options: SyntheticWorldOptions): number {
  const world = validate(options); // Before opening any output.
  const fd = openSync(path, "wx");
  try {
    let offset = 0;
    const { header, length } = encode(world, (bytes) => {
      writeAll(fd, bytes, offset);
      offset += bytes.length;
    });
    writeAll(fd, header, 0);
    return length;
  } finally {
    closeSync(fd);
  }
}
