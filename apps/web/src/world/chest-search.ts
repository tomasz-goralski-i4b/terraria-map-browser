import type { WorldChest } from "@studio/world-codec";
import { itemLabel } from "./items.js";

export interface ChestItemTotal { readonly itemId: number; readonly totalStack: number; readonly slotCount: number; readonly chestCount: number }
export interface ChestMatch { readonly chestIndex: number; readonly chest: WorldChest; readonly totalStack: number; readonly items: readonly { readonly itemId: number; readonly stack: number }[] }
export interface ChestSearchResult { readonly matches: readonly ChestMatch[]; readonly totals: readonly ChestItemTotal[] }
export interface ChestItemIndex { readonly search: (query: string) => ChestSearchResult }
function idleSlice(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof requestIdleCallback === "function") requestIdleCallback(() => { resolve(); }, { timeout: 100 });
    else setTimeout(resolve, 0);
  });
}

/** One idle job owns this index; each slice processes at most 256 slots or 8 ms. */
export async function buildChestItemIndex(chests: readonly WorldChest[], yieldSlice: () => Promise<void> = idleSlice): Promise<ChestItemIndex> {
  const byItem = new Map<number, { totalStack: number; slotCount: number; chests: Map<number, number> }>();
  let work = 0;
  let end = 0;
  for (const [chestIndex, chest] of chests.entries()) {
    if (work >= 256 || performance.now() >= end) { await yieldSlice(); work = 0; end = performance.now() + 8; }
    for (const item of chest.items) {
      if (work >= 256 || performance.now() >= end) { await yieldSlice(); work = 0; end = performance.now() + 8; }
      let entry = byItem.get(item.itemId);
      if (entry === undefined) { entry = { totalStack: 0, slotCount: 0, chests: new Map() }; byItem.set(item.itemId, entry); }
      entry.totalStack += item.stack;
      entry.slotCount++;
      entry.chests.set(chestIndex, (entry.chests.get(chestIndex) ?? 0) + item.stack);
      work++;
    }
    work++;
  }
  return { search: (query) => {
    const text = query.trim().toLowerCase();
    const exactId = /^-?\d+$/.test(text) ? Number(text) : null;
    const matches = new Map<number, { chestIndex: number; chest: WorldChest; totalStack: number; items: { itemId: number; stack: number }[] }>();
    const totals: ChestItemTotal[] = [];
    if (text === "") return { matches: [], totals };
    for (const [itemId, entry] of byItem) {
      if (exactId === null ? !itemLabel(itemId).toLowerCase().includes(text) : itemId !== exactId) continue;
      totals.push({ itemId, totalStack: entry.totalStack, slotCount: entry.slotCount, chestCount: entry.chests.size });
      for (const [chestIndex, stack] of entry.chests) {
        const chest = chests[chestIndex];
        if (chest === undefined) continue;
        let match = matches.get(chestIndex);
        if (match === undefined) { match = { chestIndex, chest, totalStack: 0, items: [] }; matches.set(chestIndex, match); }
        match.totalStack += stack;
        match.items.push({ itemId, stack });
      }
    }
    return { matches: [...matches.values()].sort((a, b) => a.chestIndex - b.chestIndex), totals: totals.sort((a, b) => a.itemId - b.itemId) };
  } };
}
