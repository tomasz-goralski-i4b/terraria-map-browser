import type { EntityItem, WorldChest } from "@studio/world-codec";
import type { Tile } from "@studio/world-model";
import type { Property } from "../ui/PropertyGrid.js";
import { contentName } from "../world/content-names.js";
import { itemLabel, prefixLabel } from "../world/items.js";

const DRESSER = 88;
/** One frame cell: a 16 px tile and its 2 px gutter in the tile's sprite sheet. */
const FRAME_CELL = 18;

/** The object at the chest's position as the game's map names it ("Chest", "Dresser"); "Chest" without a block. */
export function chestTitle(origin: Tile): string {
  return origin.block === undefined ? "Chest" : contentName(origin.block, "block", origin);
}

/**
 * The style index of the object: frame X counts whole objects (2 cells for chests, 3 for dressers) along its sheet.
 * Chests continue on a second sheet (tile 467), which numbers its styles from 0 again.
 */
function chestStyle(origin: Tile): number | undefined {
  if (origin.frameX === undefined || origin.frameX < 0) return undefined;
  const width = origin.block?.kind === "vanilla" && origin.block.id === DRESSER ? 3 : 2;
  return Math.floor(origin.frameX / (width * FRAME_CELL));
}

/** A filled slot: item, stack and, when it has one, the prefix. */
export function slotLabel(item: EntityItem): string {
  return `${itemLabel(item.itemId)} × ${String(item.stack)}${item.prefix === 0 ? "" : `, ${prefixLabel(item.prefix)}`}`;
}

/**
 * The rows of a chest: name, top-left position, style and how many slots are filled. Like the tile rows, an unnamed
 * chest shows its name only with `showAll`. With `onOpen`, the filled-slots row carries an Open button for the slots.
 */
export function chestProperties(chest: WorldChest, origin: Tile, showAll: boolean, onOpen?: () => void): Property[] {
  const text = (label: string, value: string): Property => ({ kind: "text", label, value });
  const style = chestStyle(origin);
  const filled = `${String(chest.items.length)} of ${String(chest.slotCount)}`;
  return [
    ...(chest.name.length > 0 ? [text("Name", chest.name)] : showAll ? [text("Name", "None")] : []),
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
