import type { SectionBoundary, WorldHeader } from "./header.js";

export interface EntityItem { readonly slot: number; readonly itemId: number; readonly stack: number; readonly prefix: number }
export interface WorldChest { readonly x: number; readonly y: number; readonly name: string; readonly slotCount: number; readonly items: readonly EntityItem[] }
export interface WorldSign { readonly x: number; readonly y: number; readonly text: string }
export interface WorldTownNpc { readonly npcId: number; readonly displayName: string; readonly x: number; readonly y: number; readonly homeless: boolean; readonly homeX: number; readonly homeY: number }
export interface WorldMob { readonly npcId: number; readonly x: number; readonly y: number }
export interface WorldTileEntity { readonly kind: number; readonly entityId: number; readonly x: number; readonly y: number; readonly items: readonly EntityItem[]; readonly dyes: readonly EntityItem[]; readonly misc: readonly EntityItem[]; readonly anchorItemId: number | null }
export interface WorldPressurePlate { readonly x: number; readonly y: number }
export interface WorldRoom { readonly npcId: number; readonly x: number; readonly y: number }
export interface WorldCreativePower { readonly powerId: number; readonly booleanValue: boolean | null; readonly sliderValue: number | null }
export interface EntityDataBySection {
  readonly Chests: { readonly entries: readonly WorldChest[] };
  readonly Signs: { readonly entries: readonly WorldSign[] };
  readonly NpcsAndMobs: { readonly townNpcs: readonly WorldTownNpc[]; readonly mobs: readonly WorldMob[] };
  readonly TileEntities: { readonly entries: readonly WorldTileEntity[] };
  readonly WeightedPressurePlates: { readonly entries: readonly WorldPressurePlate[] };
  readonly TownManager: { readonly entries: readonly WorldRoom[] };
  readonly Bestiary: { readonly killCount: number; readonly seenCount: number; readonly chattedCount: number };
  readonly CreativePowers: { readonly entries: readonly WorldCreativePower[] };
}
export type EntitySectionName = keyof EntityDataBySection;
export interface EntitySectionFailure { readonly code: "MalformedSection"; readonly section: EntitySectionName; readonly field: string; readonly offset: number; readonly reason: string }
export type EntitySectionResult<K extends EntitySectionName> =
  | { readonly section: K; readonly boundary: SectionBoundary; readonly data: EntityDataBySection[K]; readonly error: null }
  | { readonly section: K; readonly boundary: SectionBoundary; readonly data: null; readonly error: EntitySectionFailure };
export type WorldEntities = { readonly [K in EntitySectionName]: EntitySectionResult<K> };

/** Strict format-326 entity section entry point; diagnostics use absolute offsets. */
export function readEntitySection<K extends EntitySectionName>(_bytes: Uint8Array, _section: K, _boundary: SectionBoundary): EntityDataBySection[K] {
  throw new Error("not implemented");
}

/** Entity failures do not invalidate the independently decoded world tiles or other sections. */
export function readWorldEntities(_bytes: Uint8Array, _header?: WorldHeader): WorldEntities {
  throw new Error("not implemented");
}
