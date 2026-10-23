import { useId } from "react";
import { useModal } from "../shell/dialogs.js";
import { Toggle } from "../shell/LayerToggles.js";
import { Icon } from "../ui/Icon.js";
import { Segments } from "../ui/Segments.js";
import { formatBytes } from "../panels/world-fields.js";
import { useAreaStore } from "../world/area-session.js";
import { MAX_IMAGE_SCALE, type ImageFormat } from "../world/image-export.js";
import {
  closeImageExport, imageExportReason, runImageExport, scopeArea, setImageStyle, useImageExportStore, type ImageLayers, type ImageScope,
  type ImageStyle,
} from "../world/image-export-session.js";
import { useAssetStore } from "../assets/asset-session.js";

const SCOPES: readonly { readonly id: ImageScope; readonly label: string }[] = [
  { id: "world", label: "Whole world" }, { id: "view", label: "View" }, { id: "selection", label: "Selection" },
];
const STYLES: readonly { readonly id: ImageStyle; readonly label: string }[] = [{ id: "map", label: "Map colours" }, { id: "textured", label: "Textures" }];
const STYLE_FACTS: Readonly<Record<ImageStyle, string>> = {
  map: "Map colours, as the map shows them from afar",
  textured: "The game's textures, as the map shows them up close; drawn here, so the map may pause briefly",
};
const FORMATS: readonly { readonly id: ImageFormat; readonly label: string }[] = [{ id: "png", label: "PNG" }, { id: "jxl", label: "JPEG XL" }];
const FORMAT_NOTES: Readonly<Record<ImageFormat, string>> = { png: "Any size; opens everywhere", jxl: "Lossless and smaller; not every viewer opens it yet" };
const LAYERS: readonly (readonly [Exclude<keyof ImageLayers, "wireMask">, string])[] = [
  ["background", "Background"], ["walls", "Walls"], ["blocks", "Blocks"], ["liquids", "Liquids"], ["wires", "Wires"], ["paint", "Paint"],
];

function Field({ label, children }: { readonly label: string; readonly children: React.ReactNode }): React.JSX.Element {
  return <div className="save-field"><span className="save-field-label">{label}</span><div className="dialog-field-value">{children}</div></div>;
}

/** File ▸ Export ▸ Map Image…: area, style, scale, format and layers; the export then runs in the status bar's job cell. */
export function ExportImageDialog(): React.JSX.Element {
  const state = useImageExportStore();
  // The selection changes what the Selection scope covers.
  useAreaStore((area) => area.selection);
  // Connecting or losing the game's Images folder changes whether Textures can run.
  useAssetStore((assets) => assets.status);
  const ref = useModal(state.open, closeImageExport);
  const titleId = useId();
  const reason = imageExportReason(state);
  const area = scopeArea(state.scope);
  const set = (patch: Partial<typeof state>): void => { useImageExportStore.setState(patch); };
  return (
    <dialog ref={ref} className="dialog save-dialog" aria-labelledby={titleId}>
      <header className="dialog-header">
        <h2 id={titleId}>Export Map Image</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={closeImageExport}><Icon name="close" /></button>
      </header>
      {state.open && (
        <form className="save-body" onSubmit={(event) => { event.preventDefault(); if (reason === null) void runImageExport(); }}>
          <Field label="Area"><Segments label="Area" value={state.scope} disabled={false} options={SCOPES} onChange={(scope) => { set({ scope }); }} /></Field>
          <Field label="Style"><Segments label="Style" value={state.style} disabled={false} options={STYLES} onChange={setImageStyle} /></Field>
          <Field label="Scale">
            <div className="export-scale">
              <input className="brush-slider" type="range" aria-label="Pixels per block" min={1} max={MAX_IMAGE_SCALE} step={1} value={state.scale}
                aria-valuetext={`${String(state.scale)} pixels per block`} onChange={(event) => { set({ scale: Number(event.target.value) }); }} />
              <output>{state.scale === 1 ? "1 pixel per block" : `${String(state.scale)} pixels per block`}</output>
            </div>
          </Field>
          <Field label="Format"><Segments label="Format" value={state.format} disabled={false} options={FORMATS} onChange={(format) => { set({ format }); }} /><span className="muted">{FORMAT_NOTES[state.format]}</span></Field>
          <Field label="Layers">
            <div className="brush-segments layer-toggles" role="group" aria-label="Layers">
              {LAYERS.map(([key, label]) => (
                <Toggle key={key} label={label} pressed={state.layers[key]} disabled={false}
                  onChange={(pressed) => { set({ layers: { ...state.layers, [key]: pressed } }); }} />
              ))}
            </div>
          </Field>
          <Field label="Size">
            <span className="muted" data-testid="export-image-size">
              {area === null || area.width === 0 || area.height === 0 ? "—"
                : `${String(area.width * state.scale)} × ${String(area.height * state.scale)} px · ${formatBytes(area.width * state.scale * area.height * state.scale * 4)} uncompressed`}
            </span>
          </Field>
          <ul className="save-facts" aria-label="What it does">
            <li><Icon name="image" />{STYLE_FACTS[state.style]}</li>
            <li><Icon name="check" />Runs in the background; progress and Cancel are in the status bar</li>
          </ul>
          {reason !== null && <p className="save-notice save-notice-warning"><Icon name="info" /><span>{reason}.</span></p>}
          <footer className="dialog-footer">
            <span className="dialog-footer-spacer" />
            <button type="button" className="button" onClick={closeImageExport}>Cancel</button>
            <button type="submit" className="button button-primary" aria-disabled={reason !== null || undefined}
              {...(reason === null ? {} : { "data-tooltip": reason, "data-tooltip-side": "top" })}>Export</button>
          </footer>
        </form>
      )}
    </dialog>
  );
}
