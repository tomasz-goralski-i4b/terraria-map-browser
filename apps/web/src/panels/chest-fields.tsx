import type { EntityItem, WorldChest } from "@studio/world-codec";
import { resolveObject, type Tile } from "@studio/world-model";
import type { Property } from "../ui/PropertyGrid.js";
import { contentName } from "../world/content-names.js";
import { itemLabel, prefixLabel } from "../world/items.js";

/** The object at the chest's position as the game's map names it ("Chest", "Dresser"); "Chest" without a block. */
export function chestTitle(origin: Tile): string {
  return origin.block === undefined ? "Chest" : contentName(origin.block, "block", origin);
}

/**
 * The style of the object (docs/assets.md, "Object frames"). Chests continue on a second sheet (tile 467), which
 * numbers its styles from 0 again.
 */
function chestStyle(origin: Tile): number | undefined {
  if (origin.block?.kind !== "vanilla") return undefined;
  return resolveObject(origin.block.id, origin.frameX ?? -1, origin.frameY ?? -1)?.style;
}

/** A filled slot: item, stack and, when it has one, the prefix. */
export function slotLabel(item: EntityItem): string {
  return `${itemLabel(item.itemId)} × ${String(item.stack)}${item.prefix === 0 ? "" : `, ${prefixLabel(item.prefix)}`}`;
}

/**
 * The rows of a chest: name, top-left position, style and how many slots are filled. An unnamed chest is explicitly
 * labelled Unnamed. With `onOpen`, the filled-slots row carries an Open button for the slots.
 */
export function chestProperties(chest: WorldChest, origin: Tile, onOpen?: () => void): Property[] {
  const text = (label: string, value: string): Property => ({ kind: "text", label, value });
  const style = chestStyle(origin);
  const filled = `${String(chest.items.length)} of ${String(chest.slotCount)}`;
  return [
    text("Name", chest.name.length > 0 ? chest.name : "Unnamed"),
    text("Chest position", `${String(chest.x)}, ${String(chest.y)}`),
    ...(style === undefined ? [] : [text("Style", String(style))]),
    onOpen === undefined ? text("Filled slots", filled) : {
      kind: "custom", label: "Filled slots", value: (
        <span className="chest-filled">
          {filled}
          <button type="button" className="button chest-open" aria-label="Open chest slots" onClick={onOpen}>Open</button>
        </span>
      ),
    },
  ];
}
