import type { WorldChest, WorldTilesResult } from "@studio/world-codec";
import type { Tile } from "@studio/world-model";
import { canonicalWorldOf } from "./canonical-world.js";

export type ChestAt = (x: number, y: number) => WorldChest | null;

export interface ChestWorld { readonly width: number; readonly height: number; readonly tileAt: (x: number, y: number) => Tile }
export interface ChestFootprint { readonly x: number; readonly y: number; readonly width: number; readonly height: number }
export type ChestAnchorStatus = "valid" | "outOfBounds" | "mismatch" | "unknown";

const DRESSER = 88;

/** Chests are 2 × 2 from their top-left tile; dressers, the one vanilla 3-wide chest object, are 3 × 2. */
function footprintWidth(origin: Tile): number {
  return origin.block?.kind === "vanilla" && origin.block.id === DRESSER ? 3 : 2;
}

/** Records survive invalid anchors; only a complete, consistently framed vanilla object gets a footprint. */
export function chestAnchorStatus(chest: WorldChest, world: ChestWorld): ChestAnchorStatus {
  if (chest.x < 0 || chest.y < 0 || chest.x >= world.width || chest.y >= world.height) return "outOfBounds";
  const origin = world.tileAt(chest.x, chest.y);
  if (origin.block?.kind !== "vanilla") return origin.block === undefined ? "mismatch" : "unknown";
  if (![21, 88, 441, 467, 468].includes(origin.block.id)) return "unknown";
  const width = footprintWidth(origin);
  if (chest.x + width > world.width || chest.y + 2 > world.height) return "outOfBounds";
  if (origin.frameX === undefined || origin.frameY === undefined || origin.frameX < 0 || origin.frameY < 0 || origin.frameX % (width * 18) !== 0 || origin.frameY % 36 !== 0) return "mismatch";
  for (let dx = 0; dx < width; dx++) for (let dy = 0; dy < 2; dy++) {
    const tile = world.tileAt(chest.x + dx, chest.y + dy);
    if (tile.block?.kind !== "vanilla" || tile.block.id !== origin.block.id || tile.frameX !== origin.frameX + dx * 18 || tile.frameY !== origin.frameY + dy * 18) return "mismatch";
  }
  return "valid";
}

/** Why a record has no map target: its anchor, or a footprint shared with another record. */
export type ChestRecordStatus = ChestAnchorStatus | "ambiguous";
export interface ChestRecord { readonly status: ChestRecordStatus; readonly footprint: ChestFootprint | null }

/** Each record's anchor status and validated footprint, in record order. Any shared tile makes both objects ambiguous. */
export function chestRecords(chests: readonly WorldChest[], world: ChestWorld): readonly ChestRecord[] {
  const statuses = chests.map((chest) => chestAnchorStatus(chest, world));
  const footprints = chests.map((chest, index): ChestFootprint | null => statuses[index] === "valid"
    ? { x: chest.x, y: chest.y, width: footprintWidth(world.tileAt(chest.x, chest.y)), height: 2 }
    : null);
  const owners = new Map<number, number>();
  const ambiguous = new Set<number>();
  for (const [index, area] of footprints.entries()) {
    if (area === null) continue;
    for (let dx = 0; dx < area.width; dx++) for (let dy = 0; dy < area.height; dy++) {
      const key = (area.y + dy) * world.width + area.x + dx;
      const previous = owners.get(key);
      if (previous === undefined) owners.set(key, index);
      else { ambiguous.add(previous); ambiguous.add(index); }
    }
  }
  return footprints.map((footprint, index) => ambiguous.has(index)
    ? { status: "ambiguous", footprint: null }
    : { status: statuses[index] ?? "unknown", footprint });
}

/**
 * Maps every tile of every chest's footprint to its record, built once, so a lookup is a hash probe rather than a
 * scan of all chests. Only complete, consistently framed objects inside the world are indexed. Ambiguous overlaps
 * resolve to no record, while invalid records remain available to the Entities list and item totals.
 */
export function createChestLookup(chests: readonly WorldChest[], width: number, height: number, tileAt: (x: number, y: number) => Tile): ChestAt {
  const byTile = new Map<number, WorldChest | null>();
  const records = chestRecords(chests, { width, height, tileAt });
  for (const [index, chest] of chests.entries()) {
    const footprint = records[index]?.footprint;
    if (footprint === null || footprint === undefined) continue;
    const right = chest.x + footprint.width;
    const bottom = chest.y + footprint.height;
    for (let y = chest.y; y < bottom; y++) for (let x = chest.x; x < right; x++) {
      const key = y * width + x;
      byTile.set(key, byTile.has(key) ? null : chest);
    }
  }
  return (x, y) => (x < 0 || y < 0 || x >= width || y >= height ? null : byTile.get(y * width + x) ?? null);
}

const lookups = new WeakMap<WorldTilesResult, { readonly entries: readonly WorldChest[] | undefined; readonly lookup: ChestAt }>();

/** The chest lookup of a loaded world, built on first use; a chest section that failed to decode has no chests. */
export function chestLookupOf(loaded: WorldTilesResult): ChestAt {
  return (x, y) => {
    let cached = lookups.get(loaded);
    const entries = loaded.entities.Chests.data?.entries;
    if (cached === undefined || cached.entries !== entries) {
      const { width, height } = loaded.metadata;
      const world = canonicalWorldOf(loaded);
      cached = { entries, lookup: createChestLookup(entries ?? [], width, height, (cx, cy) => world.tileAt(cx, cy)) };
      lookups.set(loaded, cached);
    }
    return cached.lookup(x, y);
  };
}
