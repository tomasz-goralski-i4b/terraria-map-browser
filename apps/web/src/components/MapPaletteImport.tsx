import { useRef } from "react";
import { MAX_MAP_PALETTE_BYTES } from "@studio/renderer";
import { useAppStore } from "../store.js";
import { getDefaultMapPaletteImporter } from "../world/map-palette-importer.js";

/** Developer-facing POC input. How a deployed site obtains this local file remains undecided. */
export function MapPaletteImport(): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null);
  const request = useRef(0);
  const notice = useAppStore((state) => state.paletteNotice);
  const importFile = async (file: File): Promise<void> => {
    const current = ++request.current;
    try {
      if (file.size > MAX_MAP_PALETTE_BYTES) throw new Error("Map palette file exceeds 4 MiB.");
      const importer = getDefaultMapPaletteImporter();
      const json = await file.text();
      if (current !== request.current) return;
      importer.importJson(json);
      useAppStore.getState().paletteChanged(importer.notice());
    } catch (error) {
      if (current !== request.current) return;
      useAppStore.getState().setPaletteNotice(`Could not import map palette: ${error instanceof Error ? error.message : String(error)}`);
    }
  };
  return (
    <section aria-label="Local map palette (POC)">
      <button type="button" onClick={() => { input.current?.click(); }}>Import map palette (POC)</button>
      <input ref={input} type="file" accept=".json" hidden aria-label="Map palette JSON" onChange={(event) => {
        const file = event.target.files?.[0];
        event.target.value = "";
        if (file !== undefined) void importFile(file);
      }} />
      <button type="button" onClick={() => {
        request.current++;
        const importer = getDefaultMapPaletteImporter();
        importer.clear();
        useAppStore.getState().paletteChanged(importer.notice());
      }}>Use placeholder colours</button>
      <span>{notice}</span>
    </section>
  );
}
