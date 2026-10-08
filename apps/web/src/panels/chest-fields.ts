import type { WorldChest } from "@studio/world-codec";
import type { Tile } from "@studio/world-model";
import type { Property } from "../ui/PropertyGrid.js";
import { contentName } from "../world/content-names.js";
import { itemLabel, prefixLabel } from "../world/items.js";

/**
 * The rows of a chest: name, top-left position, kind (named from the tile at that position), how many slots are
 * filled, then one row per filled slot, numbered from 1 as in the game's inventory.
 */
export function chestProperties(chest: WorldChest, origin: Tile): Property[] {
  const text = (label: string, value: string): Property => ({ kind: "text", label, value });
  return [
    text("Name", chest.name.length === 0 ? "Unnamed" : chest.name),
    text("Chest position", `${String(chest.x)}, ${String(chest.y)}`),
    text("Kind", origin.block === undefined ? "None" : contentName(origin.block, "block", origin)),
    text("Filled slots", `${String(chest.items.length)} of ${String(chest.slotCount)}`),
    ...chest.items.map((item) => text(
      `Slot ${String(item.slot + 1)}`,
      `${itemLabel(item.itemId)} × ${String(item.stack)}${item.prefix === 0 ? "" : `, ${prefixLabel(item.prefix)}`}`,
    )),
  ];
}
