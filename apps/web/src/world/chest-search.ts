import type { WorldChest } from "@studio/world-codec";

export interface ChestItemTotal { readonly itemId: number; readonly totalStack: number; readonly slotCount: number; readonly chestCount: number }
export interface ChestMatch { readonly chestIndex: number; readonly chest: WorldChest; readonly totalStack: number; readonly items: readonly { readonly itemId: number; readonly stack: number }[] }
export interface ChestSearchResult { readonly matches: readonly ChestMatch[]; readonly totals: readonly ChestItemTotal[] }
export interface ChestItemIndex { readonly search: (query: string) => ChestSearchResult }
export async function buildChestItemIndex(_chests: readonly WorldChest[], _yieldSlice: () => Promise<void> = () => Promise.resolve()): Promise<ChestItemIndex> {
  throw new Error("not implemented");
}
