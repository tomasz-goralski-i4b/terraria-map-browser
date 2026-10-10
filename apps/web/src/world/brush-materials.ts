import { terrariaFramingData, terrariaMapNames, terrariaMapPalette } from "@studio/renderer";
import { isFrameImportant, resolveWorldFormat, type WorldTilesResult } from "@studio/world-codec";
import type { BrushContentLayer } from "@studio/world-model";

/** Something a brush can put down: a block or wall, with its English name and map colour (0xRRGGBB). */
export interface BrushMaterial {
  readonly layer: BrushContentLayer;
  readonly id: number;
  readonly name: string;
  readonly color: number | null;
}

export interface BrushPaint {
  readonly id: number;
  readonly name: string;
  readonly color: number;
}

export interface BrushMaterials {
  readonly blocks: readonly BrushMaterial[];
  readonly walls: readonly BrushMaterial[];
  /** Paints 1…; 0 (no paint) is not listed. */
  readonly paints: readonly BrushPaint[];
}

const byName = (a: BrushMaterial, b: BrushMaterial): number => a.name.localeCompare(b.name) || a.id - b.id;

function material(layer: BrushContentLayer, id: number): BrushMaterial | null {
  const name = (layer === "block" ? terrariaMapNames.tiles : terrariaMapNames.walls)[id]?.[0];
  if (name === undefined || name.length === 0) return null;
  const color = (layer === "block" ? terrariaMapPalette.tiles : terrariaMapPalette.walls)[id]?.[0] ?? null;
  return { layer, id, name, color };
}

const PAINTS: readonly BrushPaint[] = terrariaMapNames.paints.flatMap((name, id) => {
  const color = terrariaMapPalette.paints[id];
  return id === 0 || name.length === 0 || color === undefined ? [] : [{ id, name, color }];
});

const cache = new WeakMap<WorldTilesResult, BrushMaterials>();

/**
 * What a brush may place in this world: blocks that frame themselves from their neighbours (the framing database's
 * block types; objects and other frame-important tiles need their own placement rules), every named wall, and the
 * named paints, all limited to the content ids the world's format defines.
 */
export function brushMaterials(world: WorldTilesResult): BrushMaterials {
  let materials = cache.get(world);
  if (materials === undefined) {
    const profile = resolveWorldFormat(world.header.version);
    const maxTile = profile?.maxTileId ?? -1;
    const maxWall = profile?.maxWallId ?? -1;
    const blocks = terrariaFramingData.blockTypes
      .filter((id) => id <= maxTile && !isFrameImportant(world.sections, id))
      .flatMap((id) => material("block", id) ?? []);
    const walls = terrariaMapNames.walls.flatMap((_, id) => (id === 0 || id > maxWall ? [] : material("wall", id) ?? []));
    materials = { blocks: blocks.sort(byName), walls: walls.sort(byName), paints: PAINTS };
    cache.set(world, materials);
  }
  return materials;
}

/** The material of a layer and id, if it is in the list. */
export function findMaterial(materials: BrushMaterials, layer: BrushContentLayer, id: number): BrushMaterial | undefined {
  return (layer === "block" ? materials.blocks : materials.walls).find((candidate) => candidate.id === id);
}
