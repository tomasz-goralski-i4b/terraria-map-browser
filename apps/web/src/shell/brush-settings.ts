import { BRUSH_LAYER } from "@studio/world-model";

export const BRUSH_LAYER_OPTIONS = [
  { id: BRUSH_LAYER.block, label: "Blocks" },
  { id: BRUSH_LAYER.wall, label: "Walls" },
  { id: BRUSH_LAYER.both, label: "Both" },
] as const;
export const BRUSH_MATERIALS = [
  { label: "Dirt", blockId: 0, wallId: 2 },
  { label: "Stone", blockId: 1, wallId: 1 },
  { label: "Wood", blockId: 30, wallId: 4 },
  { label: "Gray brick", blockId: 38, wallId: 5 },
] as const;
export const BRUSH_SIZE = { minimum: 1, maximum: 9 } as const;
export const BRUSH_MATERIAL_FIELDS = {
  [BRUSH_LAYER.block]: { label: "Block", accessibleName: "Block material", idKey: "blockId" },
  [BRUSH_LAYER.wall]: { label: "Wall", accessibleName: "Wall material", idKey: "wallId" },
} as const;
