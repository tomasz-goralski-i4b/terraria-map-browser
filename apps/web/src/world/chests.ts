import type { WorldChest, WorldTilesResult } from "@studio/world-codec";
import type { Tile } from "@studio/world-model";
import { canonicalWorldOf } from "./canonical-world.js";

export type ChestAt = (x: number, y: number) => WorldChest | null;

const DRESSER = 88;

/** Chests are 2 × 2 from their top-left tile; dressers, the one vanilla 3-wide chest object, are 3 × 2. */
function footprintWidth(origin: Tile): number {
  return origin.block?.kind === "vanilla" && origin.block.id === DRESSER ? 3 : 2;
}

/**
 * Maps every tile of every chest's footprint to its record, built once, so a lookup is a hash probe rather than a
 * scan of all chests. The footprint size comes from the tile at the record's position; tiles past the world edge
 * are dropped.
 */
export function createChestLookup(chests: readonly WorldChest[], width: number, height: number, tileAt: (x: number, y: number) => Tile): ChestAt {
  const byTile = new Map<number, WorldChest>();
  for (const chest of chests) {
    if (chest.x < 0 || chest.y < 0 || chest.x >= width || chest.y >= height) continue;
    const right = Math.min(width, chest.x + footprintWidth(tileAt(chest.x, chest.y)));
    const bottom = Math.min(height, chest.y + 2);
    for (let y = chest.y; y < bottom; y++) for (let x = chest.x; x < right; x++) byTile.set(y * width + x, chest);
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
