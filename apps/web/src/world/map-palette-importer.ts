import { parseMapPalette } from "@studio/renderer";
import type { MapPalette } from "@studio/renderer";

export const MAP_PALETTE_STORAGE_KEY = "terraria-map-studio.map-palette.v1";

type PaletteStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** Origin-local persistence; the imported table is never part of React state or uploaded. */
export function createMapPaletteImporter(storage?: PaletteStorage): {
  load: () => MapPalette | null;
  importJson: (json: string) => MapPalette;
  clear: () => void;
  notice: () => string;
} {
  let palette: MapPalette | null = null;
  let restored = false;
  let message = "Placeholder colours. No local map palette imported.";
  const importJson = (json: string): MapPalette => {
    const imported = parseMapPalette(json);
    // Commit only validated input, even when saving is unavailable.
    palette = imported;
    restored = true;
    message = `Local map palette: Terraria ${imported.gameVersion} (POC, base colours).`;
    try {
      if (storage === undefined) throw new Error("Storage unavailable");
      storage.setItem(MAP_PALETTE_STORAGE_KEY, json);
    } catch {
      message += " Available for this page session only.";
    }
    return imported;
  };
  return {
    load: () => {
      if (!restored) {
        restored = true;
        try {
          const json = storage?.getItem(MAP_PALETTE_STORAGE_KEY);
          if (json !== undefined && json !== null) {
            palette = parseMapPalette(json);
            message = `Local map palette: Terraria ${palette.gameVersion} (POC, base colours).`;
          }
        } catch {
          message = "Saved map palette unavailable or invalid. Using placeholder colours; import a valid palette.";
        }
      }
      return palette;
    },
    importJson,
    clear: () => {
      palette = null;
      restored = true;
      message = "Placeholder colours. No local map palette imported.";
      try { storage?.removeItem(MAP_PALETTE_STORAGE_KEY); } catch { message += " Could not clear browser storage."; }
    },
    notice: () => message,
  };
}

let defaultImporter: ReturnType<typeof createMapPaletteImporter> | undefined;

export function getDefaultMapPaletteImporter(): ReturnType<typeof createMapPaletteImporter> {
  if (defaultImporter === undefined) {
    let storage: Storage | undefined;
    try { storage = window.localStorage; } catch { /* Private mode can deny access to storage entirely. */ }
    defaultImporter = createMapPaletteImporter(storage);
  }
  return defaultImporter;
}
