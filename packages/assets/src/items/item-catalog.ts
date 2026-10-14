/** Data observed from the game; no textures or executable game code are shipped. */
export interface ItemIconFrame {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface ItemCatalogEntry {
  readonly id: number;
  readonly name: string;
  readonly nameStatus: "resolved" | "empty" | "unnamed";
  readonly symbols: readonly string[];
  readonly textureId: number | null;
  /** First inventory frame, relative to the resolved Item_<textureId>.xnb sheet. */
  readonly frame: ItemIconFrame | null;
  readonly spriteStatus: "available" | "empty" | "missing";
}

export interface ItemCatalog {
  readonly schemaVersion: 1;
  readonly gameVersion: string;
  readonly assemblySha256: string;
  readonly itemCount: number;
  /** Index is the prefix ID; index 0 is the empty prefix. */
  readonly prefixes: readonly string[];
  /** Index is the item ID; index 0 represents an empty item. */
  readonly items: readonly ItemCatalogEntry[];
}
