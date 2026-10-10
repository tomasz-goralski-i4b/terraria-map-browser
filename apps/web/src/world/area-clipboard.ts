import { readTileEntityPayloads, type TileEntityPayload, type WorldTilesResult } from "@studio/world-codec";
import { createWorld, viewWorld, type CanonicalWorld, type TileDiff, type WorldPlanes } from "@studio/world-model";
import { canonicalWorldOf } from "./canonical-world.js";
import { brushDisabledReason } from "./brush-session.js";

export interface Area { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export interface CopyLayers { readonly blocks: boolean; readonly walls: boolean; readonly liquids: boolean; readonly wires: boolean; readonly paint: boolean; readonly objects: boolean }
/**
 * How a paste combines with what is there. "transparent" makes the copy's empty cells (no block, no wall) keep the
 * destination's block or wall; "merge" adds copied liquid to liquid of the same kind. Copied content always lands.
 */
export interface PasteOptions { readonly air: "replace" | "transparent"; readonly walls: "replace" | "transparent"; readonly liquids: "replace" | "merge" }
export const DEFAULT_COPY_LAYERS: CopyLayers = { blocks: true, walls: true, liquids: true, wires: true, paint: true, objects: true };
export const DEFAULT_PASTE_OPTIONS: PasteOptions = { air: "replace", walls: "replace", liquids: "replace" };
/** The largest selection Copy accepts, bounding the clipboard and preview allocations. */
export const MAX_AREA_TILES = 262144;
type ObjectSection = "Chests" | "Signs" | "TileEntities" | "WeightedPressurePlates";
const OBJECT_SECTIONS: readonly ObjectSection[] = ["Chests", "Signs", "TileEntities", "WeightedPressurePlates"];
type ObjectRecords = Pick<WorldTilesResult["entities"], ObjectSection>;
export interface AreaClipboard { readonly world: CanonicalWorld; readonly layers: CopyLayers; readonly blocked: Uint8Array; readonly objects: readonly (readonly number[])[]; readonly records: ObjectRecords; readonly payloads: readonly TileEntityPayload[] }
export interface AreaPaste { readonly tiles: readonly TileDiff[]; readonly palette: CanonicalWorld["palette"]; readonly apply: (direction: "before" | "after") => void }
const PLANE_NAMES: readonly (keyof WorldPlanes)[] = ["block", "wall", "frameX", "frameY", "paint", "wallPaint", "liquid", "liquidAmount", "shape", "flags"];
const framed = (world: WorldTilesResult, x: number, y: number): boolean => {
  if (x < 0 || y < 0 || x >= world.metadata.width || y >= world.metadata.height) return false;
  const ref = world.palette[world.planes.block[x * world.metadata.height + y] ?? 0xffff];
  return ref?.kind === "vanilla" && ((world.envelope.frameImportantBits[ref.id >> 3] ?? 0) & (1 << (ref.id & 7))) !== 0;
};
function editable(world: WorldTilesResult): void {
  const reason = brushDisabledReason(world);
  if (reason !== null) throw new Error(reason);
}

/** Connected frame-important tiles are treated conservatively as one object, including adjacent equal objects. */
export function copyArea(world: WorldTilesResult, area: Area, layers: CopyLayers = DEFAULT_COPY_LAYERS): AreaClipboard {
  editable(world);
  const { x: left, y: top, width, height } = area;
  if (![left, top, width, height].every(Number.isSafeInteger) || left < 0 || top < 0 || width < 1 || height < 1 || left + width > world.metadata.width || top + height > world.metadata.height || width * height > MAX_AREA_TILES) throw new RangeError(`Select up to ${MAX_AREA_TILES.toLocaleString("en-US")} tiles inside the world`);
  const planes = createWorld(width, height).planes;
  for (const name of PLANE_NAMES) for (let x = 0; x < width; x++) planes[name].set(world.planes[name].subarray((left + x) * world.metadata.height + top, (left + x) * world.metadata.height + top + height), x * height);
  const snapshot = viewWorld(width, height, planes, structuredClone(world.palette), { indicesChecked: true });
  const blocked = new Uint8Array(width * height);
  const visited = new Set<number>();
  const objects: number[][] = [];
  for (let x = 0; x < width; x++) for (let y = 0; y < height; y++) {
    const start = x * height + y;
    if (visited.has(start) || !framed(world, left + x, top + y)) continue;
    const block = snapshot.planes.block[start];
    const group = [start]; visited.add(start);
    let complete = layers.blocks && layers.objects;
    for (const index of group) {
      const gx = Math.floor(index / height), gy = index % height;
      for (const [nx, ny] of [[gx - 1, gy], [gx + 1, gy], [gx, gy - 1], [gx, gy + 1]] as const) {
        if (!framed(world, left + nx, top + ny)) continue;
        if (world.planes.block[(left + nx) * world.metadata.height + top + ny] !== block) continue;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) { complete = false; continue; }
        const neighbor = nx * height + ny;
        if (snapshot.planes.block[neighbor] !== block || visited.has(neighbor)) continue;
        visited.add(neighbor); group.push(neighbor);
      }
    }
    if (complete) objects.push(group);
    else for (const index of group) blocked[index] = 1;
  }
  // Records are copied only with the complete framed component containing their anchor.
  const included = new Set(objects.flat());
  // Chest/sign dimensions are explicit in their existing inspector contract. Malformed or partial bodies are omitted.
  for (const name of ["Chests", "Signs"] as const) for (const entry of world.entities[name].data?.entries ?? []) {
    const origin = world.palette[world.planes.block[entry.x * world.metadata.height + entry.y] ?? 0xffff];
    const bodyWidth = name === "Chests" && origin?.kind === "vanilla" && origin.id === 88 ? 3 : 2;
    const body: number[] = [];
    let complete = layers.blocks && layers.objects;
    for (let dx = 0; dx < bodyWidth; dx++) for (let dy = 0; dy < 2; dy++) {
      const sx = entry.x + dx - left, sy = entry.y + dy - top;
      if (sx < 0 || sy < 0 || sx >= width || sy >= height) { complete = false; continue; }
      const index = sx * height + sy;
      body.push(index);
      if (!included.has(index) || snapshot.planes.block[index] !== snapshot.planes.block[(entry.x - left) * height + entry.y - top]) complete = false;
    }
    if (!complete) {
      for (const group of objects) if (group.some((index) => body.includes(index))) for (const index of group) { blocked[index] = 1; included.delete(index); }
      for (const index of body) { blocked[index] = 1; included.delete(index); }
    }
  }
  const records = structuredClone(Object.fromEntries(OBJECT_SECTIONS.map((name) => [name, world.entities[name]]))) as ObjectRecords;
  for (const name of OBJECT_SECTIONS) {
    const entries = records[name].data?.entries.filter((entry) => included.has((entry.x - left) * height + entry.y - top) && entry.x >= left && entry.y >= top && entry.x < left + width && entry.y < top + height).map((entry) => ({ ...entry, x: entry.x - left, y: entry.y - top })) ?? [];
    Object.assign(records[name], { data: { entries } });
  }
  const payloads = structuredClone(world.envelope.tileEntityPayloads ?? readTileEntityPayloads(world.envelope.source, world.sections.tileEntities, world.header.version));
  return { world: snapshot, layers: { ...layers }, blocked, objects: objects.filter((group) => group.every((index) => included.has(index))), records, payloads };
}

/** Builds a read-only preview diff. Existing objects are protected; place the preview in free space. */
export function planAreaPaste(world: WorldTilesResult, clipboard: AreaClipboard, x: number, y: number, options: PasteOptions = DEFAULT_PASTE_OPTIONS): AreaPaste {
  const steps = areaPasteSteps(world, clipboard, x, y, options);
  let step = steps.next();
  while (!step.done) step = steps.next();
  return step.value;
}

/** Each yield bounds preview work; callers can discard the iterator when its inputs change. */
export function* areaPasteSteps(world: WorldTilesResult, clipboard: AreaClipboard, x: number, y: number, options: PasteOptions = DEFAULT_PASTE_OPTIONS): Generator<void, AreaPaste> {
  editable(world);
  if (![x, y].every(Number.isSafeInteger)) throw new RangeError("Paste coordinates must be integers");
  const source = clipboard.world, target = canonicalWorldOf(world), layers = clipboard.layers;
  const skip = clipboard.blocked.slice();
  const inside = (index: number): boolean => {
    const tx = x + Math.floor(index / source.height), ty = y + index % source.height;
    return tx >= 0 && ty >= 0 && tx < target.width && ty < target.height;
  };
  for (const group of clipboard.objects) if (group.some((index) => !inside(index))) for (const index of group) skip[index] = 1;
  const palette = [...world.palette];
  const paletteKeys = new Map(palette.map((ref, index) => [JSON.stringify(ref), index]));
  const remap = (value: number): number => {
    const ref = source.palette[value];
    if (ref === undefined) return 0xffff;
    if (ref.kind !== "vanilla") throw new Error("Editing modded or unknown content is disabled");
    const key = JSON.stringify(ref), existing = paletteKeys.get(key);
    if (existing !== undefined) return existing;
    if (palette.length >= 0xffff) throw new RangeError("CWM palette exceeds 65535 entries");
    paletteKeys.set(key, palette.length); palette.push({ ...ref }); return palette.length - 1;
  };
  const tiles: TileDiff[] = [];
  const protectedCells = new Set<number>();
  for (const name of OBJECT_SECTIONS) for (const entry of world.entities[name].data?.entries ?? []) {
    const origin = world.palette[world.planes.block[entry.x * target.height + entry.y] ?? 0xffff];
    const width = name === "TileEntities" ? 9 : name === "WeightedPressurePlates" ? 1 : name === "Chests" && origin?.kind === "vanilla" && origin.id === 88 ? 3 : 2;
    const height = name === "TileEntities" ? 9 : name === "WeightedPressurePlates" ? 1 : 2;
    const offset = name === "TileEntities" ? 4 : 0;
    for (let dx = 0; dx < width; dx++) for (let dy = 0; dy < height; dy++) {
      const tx = entry.x + dx - offset, ty = entry.y + dy - offset;
      if (tx >= 0 && ty >= 0 && tx < target.width && ty < target.height) protectedCells.add(tx * target.height + ty);
    }
    yield;
  }
  for (let sx = 0; sx < source.width; sx++) for (let sy = 0; sy < source.height; sy++) {
    const si = sx * source.height + sy, tx = x + sx, ty = y + sy;
    if (si % 256 === 0) yield;
    if (!inside(si)) continue;
    const ti = tx * target.height + ty;
    const blockWrite = layers.blocks && skip[si] === 0 && (options.air === "replace" || source.planes.block[si] !== 0xffff);
    const wallWrite = layers.walls && (options.walls === "replace" || source.planes.wall[si] !== 0xffff);
    const values = Object.fromEntries(PLANE_NAMES.map((name) => [name, target.planes[name][ti] ?? 0])) as Record<keyof WorldPlanes, number>;
    const sourceFlags = source.planes.flags[si] ?? 0;
    if (blockWrite) {
      for (const name of ["block", "frameX", "frameY", "shape"] as const) values[name] = name === "block" ? remap(source.planes.block[si] ?? 0xffff) : source.planes[name][si] ?? 0;
      values.flags = (values.flags & ~0x160) | (sourceFlags & 0x160);
    }
    if (wallWrite) { values.wall = remap(source.planes.wall[si] ?? 0xffff); values.flags = (values.flags & ~0x280) | (sourceFlags & 0x280); }
    if (layers.paint) {
      if (blockWrite || (!layers.blocks && source.planes.block[si] !== 0xffff && values.block !== 0xffff)) values.paint = source.planes.paint[si] ?? 0;
      if (wallWrite || (!layers.walls && source.planes.wall[si] !== 0xffff && values.wall !== 0xffff)) values.wallPaint = source.planes.wallPaint[si] ?? 0;
    } else {
      if (blockWrite && values.block === 0xffff) values.paint = 0;
      if (wallWrite && values.wall === 0xffff) values.wallPaint = 0;
    }
    if (layers.wires) values.flags = (values.flags & ~0x1f) | (sourceFlags & 0x1f);
    if (layers.liquids) {
      const kind = source.planes.liquid[si] ?? 0, amount = source.planes.liquidAmount[si] ?? 0;
      if (options.liquids === "replace") { values.liquid = kind; values.liquidAmount = amount; }
      else if (kind !== 0 && (values.liquid === 0 || values.liquid === kind)) { values.liquid = kind; values.liquidAmount = Math.min(255, values.liquidAmount + amount); }
    }
    const changes = PLANE_NAMES.flatMap((plane) => {
      const before = target.planes[plane][ti] ?? 0, after = values[plane];
      return before === after ? [] : [{ plane, before, after }];
    });
    if (blockWrite && (framed(world, tx, ty) || protectedCells.has(ti)) && changes.some((change) => ["block", "frameX", "frameY", "shape"].includes(change.plane))) throw new Error("Paste would overwrite an existing object. Choose free space.");
    if (changes.length !== 0) tiles.push({ x: tx, y: ty, changes });
  }
  const beforeRecords = Object.fromEntries(OBJECT_SECTIONS.map((name) => [name, world.entities[name].data])) as Record<ObjectSection, unknown>;
  const beforePayloads = world.envelope.tileEntityPayloads;
  let afterPayloads = beforePayloads;
  const afterRecords = Object.fromEntries(OBJECT_SECTIONS.map((name) => {
    const additions = clipboard.records[name].data?.entries.filter((entry) => skip[entry.x * source.height + entry.y] === 0 && inside(entry.x * source.height + entry.y)).map((entry) => ({ ...structuredClone(entry), x: x + entry.x, y: y + entry.y })) ?? [];
    if (additions.some((entry) => world.entities[name].data?.entries.some((existing) => existing.x === entry.x && existing.y === entry.y))) throw new Error("Paste would overlap an existing entity. Choose free space.");
    if (name === "TileEntities" && additions.length !== 0) {
      const payloads = [...world.envelope.tileEntityPayloads ?? readTileEntityPayloads(world.envelope.source, world.sections.tileEntities, world.header.version)];
      let next = (world.entities.TileEntities.data?.entries.reduce((maximum, entry) => Math.max(maximum, entry.entityId), -1) ?? -1) + 1;
      for (const entry of additions) {
        if (!("entityId" in entry) || typeof entry.entityId !== "number") throw new Error("Missing tile entity identity");
        const originalId = entry.entityId;
        const payload = clipboard.payloads.find((candidate) => candidate.entityId === originalId);
        if (payload === undefined || next > 0x7fffffff || entry.x > 32767 || entry.y > 32767) throw new Error("This tile entity cannot be represented at the paste position");
        payloads.push({ ...payload, entityId: next });
        Object.assign(entry, { entityId: next++ });
      }
      afterPayloads = payloads;
    }
    return [name, additions.length === 0 ? world.entities[name].data : { entries: [...world.entities[name].data?.entries ?? [], ...additions] }];
  })) as Record<ObjectSection, unknown>;
  return { tiles, palette, apply: (direction) => {
    if (direction === "after") {
      for (const ref of palette.slice(world.palette.length)) target.internContent(ref);
    }
    for (const tile of tiles) for (const change of tile.changes) target.planes[change.plane][tile.x * target.height + tile.y] = change[direction];
    for (const name of OBJECT_SECTIONS) Object.assign(world.entities[name], { data: direction === "after" ? afterRecords[name] : beforeRecords[name] });
    const payloads = direction === "after" ? afterPayloads : beforePayloads;
    if (payloads === undefined) Reflect.deleteProperty(world.envelope, "tileEntityPayloads");
    else Object.assign(world.envelope, { tileEntityPayloads: payloads });
  } };
}
