import { useDeferredValue, useEffect, useId, useMemo, useRef, useState } from "react";
import { readSpritePixels, type AtlasEntry, type SheetKind, type SpriteAtlas } from "@studio/assets";
import { Icon } from "../ui/Icon.js";
import { contentName } from "../world/content-names.js";

const ZOOMS = [1, 2, 3, 4] as const;

function sheetName(entry: AtlasEntry): string {
  return contentName({ kind: "vanilla", id: entry.id }, entry.kind === "tile" ? "block" : "wall");
}

function fileName(entry: AtlasEntry): string {
  return `${entry.kind === "tile" ? "Tiles" : "Wall"}_${String(entry.id)}`;
}

/** Draws the sheet at `zoom` with nearest-neighbour scaling and, optionally, the outline of every frame cell. */
function drawSheet(canvas: HTMLCanvasElement, atlas: SpriteAtlas, entry: AtlasEntry, zoom: number, grid: boolean): void {
  canvas.width = entry.width * zoom;
  canvas.height = entry.height * zoom;
  const context = canvas.getContext("2d");
  if (context === null) return;
  const source = document.createElement("canvas");
  source.width = entry.width;
  source.height = entry.height;
  const pixels = new Uint8ClampedArray(readSpritePixels(atlas, entry));
  source.getContext("2d")?.putImageData(new ImageData(pixels, entry.width, entry.height), 0, 0);
  context.imageSmoothingEnabled = false;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(source, 0, 0, canvas.width, canvas.height);
  if (!grid) return;
  const stepX = entry.frameWidth + entry.gapX;
  const stepY = entry.frameHeight + entry.gapY;
  context.strokeStyle = "rgb(255 0 200 / 0.55)";
  context.lineWidth = 1;
  for (let y = 0; y + entry.frameHeight <= entry.height; y += stepY) {
    for (let x = 0; x + entry.frameWidth <= entry.width; x += stepX) {
      context.strokeRect(x * zoom + 0.5, y * zoom + 0.5, entry.frameWidth * zoom - 1, entry.frameHeight * zoom - 1);
    }
  }
}

/**
 * The sheets of the built atlas, as a modal `<dialog>`: a filterable list of tile and wall sheets and the selected
 * sheet drawn from the atlas pages, with its frame grid. Read only; it shows what the renderer will sample.
 */
export function SpritePreviewDialog({ atlas, onClose }: { readonly atlas: SpriteAtlas; readonly onClose: () => void }): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const titleId = useId();
  const [kind, setKind] = useState<SheetKind>("tile");
  const [filter, setFilter] = useState("");
  const deferredFilter = useDeferredValue(filter);
  const [selected, setSelected] = useState<AtlasEntry | null>(null);
  const [zoom, setZoom] = useState<number>(2);
  const [grid, setGrid] = useState(true);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return undefined;
    // Not closed in the cleanup (see ChestDialog): unmounting removes the dialog and ends the modal state.
    if (!dialog.open) dialog.showModal();
    const onClick = (event: MouseEvent): void => {
      if (event.target === dialog) dialog.close();
    };
    dialog.addEventListener("close", onClose);
    dialog.addEventListener("click", onClick);
    return () => {
      dialog.removeEventListener("close", onClose);
      dialog.removeEventListener("click", onClick);
    };
  }, [onClose]);

  const entries = useMemo(() => {
    const needle = deferredFilter.trim().toLowerCase();
    return atlas.index.entries
      .filter((entry) => entry.kind === kind)
      .map((entry) => ({ entry, name: sheetName(entry) }))
      .filter(({ entry, name }) => needle === "" || String(entry.id) === needle || name.toLowerCase().includes(needle) || fileName(entry).toLowerCase().includes(needle))
      .sort((a, b) => a.entry.id - b.entry.id);
  }, [atlas, kind, deferredFilter]);

  const shown = selected?.kind === kind ? selected : (entries[0]?.entry ?? null);

  useEffect(() => {
    if (canvas.current !== null && shown !== null) drawSheet(canvas.current, atlas, shown, zoom, grid);
  }, [atlas, shown, zoom, grid]);

  return (
    <dialog ref={ref} className="dialog sprite-dialog" aria-labelledby={titleId}>
      <header className="dialog-header">
        <h2 id={titleId}>Sprite sheets</h2>
        <span className="sprite-dialog-actions">
          <span className="segmented" role="group" aria-label="Sheet family">
            {(["tile", "wall"] as const).map((family) => (
              <button key={family} type="button" className="button" aria-pressed={kind === family} onClick={() => { setKind(family); }}>
                {family === "tile" ? "Blocks" : "Walls"}
              </button>
            ))}
          </span>
          <button type="button" className="icon-button" aria-label="Close" onClick={() => ref.current?.close()}><Icon name="close" /></button>
        </span>
      </header>
      <div className="sprite-body">
        <div className="sprite-list-pane">
          <input
            type="search" className="sprite-filter" placeholder="Filter by id or name" aria-label="Filter sheets" value={filter}
            onChange={(event) => { setFilter(event.target.value); }}
          />
          <ul className="sprite-list" role="listbox" aria-label="Sheets">
            {entries.map(({ entry, name }) => (
              <li
                key={entry.id} role="option" aria-selected={shown === entry} tabIndex={-1}
                onClick={() => { setSelected(entry); }}
              >
                <span className="sprite-id">{entry.id}</span>
                <span className="sprite-name">{name}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className="sprite-view-pane">
          {shown === null ? (
            <p className="panel-empty">No sheet matches the filter.</p>
          ) : (
            <>
              <div className="sprite-toolbar">
                <span className="sprite-info">
                  <code>{fileName(shown)}</code> · {sheetName(shown)} · {shown.width}×{shown.height} px · frame {shown.frameWidth}×{shown.frameHeight}, gutter {shown.gapX}×{shown.gapY} · atlas page {shown.page + 1}
                </span>
                <label className="sprite-control">
                  <input type="checkbox" checked={grid} onChange={(event) => { setGrid(event.target.checked); }} /> Frame grid
                </label>
                <label className="sprite-control">
                  Zoom
                  <select value={zoom} onChange={(event) => { setZoom(Number(event.target.value)); }}>
                    {ZOOMS.map((value) => <option key={value} value={value}>{value}×</option>)}
                  </select>
                </label>
              </div>
              <div className="sprite-canvas-wrap">
                <canvas ref={canvas} className="sprite-canvas" aria-label={`${fileName(shown)} sprite sheet`} />
              </div>
            </>
          )}
        </div>
      </div>
    </dialog>
  );
}
