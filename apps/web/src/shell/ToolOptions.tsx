import { useEffect, useMemo, useRef, useState } from "react";
import { BRUSH_LAYER, BRUSH_SHAPE, BRUSH_SIZE, type BrushContentLayer } from "@studio/world-model";
import { MaterialSwatch, paintColor, paintLabel, swatchName } from "../panels/material-swatch.js";
import { showSwatches } from "../panels/SwatchesPanel.js";
import { Icon } from "../ui/Icon.js";
import { IconButton } from "../ui/IconButton.js";
import { findMaterial, type BrushMaterials } from "../world/brush-materials.js";
import { brushLayers, chooseBrushPaint, finishBrush, loadedBrushMaterials, setBrushSize, useBrushStore } from "../world/brush-session.js";
import { commandById, TOOLS, useCommands, type Command } from "./commands.js";
import { useViewStore } from "./view-store.js";

const LAYER_OPTIONS = [
  { id: BRUSH_LAYER.block, label: "Blocks" },
  { id: BRUSH_LAYER.wall, label: "Walls" },
  { id: BRUSH_LAYER.both, label: "Both" },
] as const;
const LAYER_NAMES: Readonly<Record<BrushContentLayer, string>> = { block: "Block", wall: "Wall" };

/** The material of one layer, shown as its swatch and name; a click opens the Swatches panel on that layer. */
function MaterialChip({ layer, materials, disabled }: { readonly layer: BrushContentLayer; readonly materials: BrushMaterials | null; readonly disabled: boolean }): React.JSX.Element {
  const brush = useBrushStore();
  const [id, paint] = layer === "block" ? [brush.blockId, brush.blockPaint] : [brush.wallId, brush.wallPaint];
  const material = materials === null ? undefined : findMaterial(materials, layer, id);
  const name = swatchName(materials, layer, id, paint);
  return (
    <button
      type="button" className="material-chip" disabled={disabled} aria-label={`${LAYER_NAMES[layer]} material: ${name}`}
      data-tooltip={`${LAYER_NAMES[layer]}: ${name} — click to choose (Swatches panel), Alt+click the map to pick`} data-tooltip-side="bottom"
      onClick={() => { showSwatches(layer); }}
    >
      <MaterialSwatch color={material?.color ?? null} paint={paintColor(materials, paint)} layer={layer} />
      <span className="material-chip-name">{material?.name ?? "—"}</span>
    </button>
  );
}

/** The paint a layer is put down with: a colour button opening a grid of the paints, as an image editor's colour well. */
function PaintWell({ layer, materials, disabled }: { readonly layer: BrushContentLayer; readonly materials: BrushMaterials | null; readonly disabled: boolean }): React.JSX.Element {
  const paint = useBrushStore((state) => (layer === "block" ? state.blockPaint : state.wallPaint));
  // Where the open popover goes: fixed under the well, since the options bar scrolls and would clip it.
  const [open, setOpen] = useState<{ readonly left: number; readonly top: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open === null) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      if (!(root.current?.contains(event.target as Node) ?? false)) setOpen(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); };
  }, [open]);
  const label = `${LAYER_NAMES[layer]} paint: ${paintLabel(materials, paint)}`;
  const choose = (next: number): void => {
    chooseBrushPaint(next, [layer]);
    setOpen(null);
    button.current?.focus();
  };
  return (
    <div ref={root} className="paint-well">
      <button
        ref={button} type="button" className="paint-well-button" disabled={disabled} aria-label={label} aria-haspopup="dialog" aria-expanded={open !== null}
        data-tooltip={label} data-tooltip-side="bottom" data-none={paint === 0}
        style={paint === 0 ? undefined : { backgroundColor: `#${(paintColor(materials, paint) ?? 0).toString(16).padStart(6, "0")}` }}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect();
          setOpen(open === null ? { left: Math.min(rect.left, window.innerWidth - 204), top: rect.bottom + 4 } : null);
        }}
      />
      {open !== null && materials !== null && (
        <div
          className="paint-popover" role="dialog" aria-label={`${LAYER_NAMES[layer]} paint`} style={{ left: open.left, top: open.top }}
          onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); setOpen(null); button.current?.focus(); } }}
        >
          <button type="button" className="paint-none" aria-pressed={paint === 0} autoFocus={paint === 0} onClick={() => { choose(0); }}>No paint</button>
          <div className="paint-grid" role="group" aria-label="Paints">
            {materials.paints.map((candidate) => (
              <button
                key={candidate.id} type="button" className="paint-cell" aria-label={candidate.name} title={candidate.name} aria-pressed={paint === candidate.id}
                autoFocus={paint === candidate.id} style={{ backgroundColor: `#${candidate.color.toString(16).padStart(6, "0")}` }}
                onClick={() => { choose(candidate.id); }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function Segments<T extends string>({ label, options, value, disabled, onChange }: {
  readonly label: string;
  readonly options: readonly { readonly id: T; readonly label: React.ReactNode; readonly title?: string }[];
  readonly value: T;
  readonly disabled: boolean;
  readonly onChange: (value: T) => void;
}): React.JSX.Element {
  return (
    <div className="brush-segments" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id} type="button" aria-pressed={value === option.id} disabled={disabled}
          {...(option.title === undefined ? {} : { "aria-label": option.title, title: option.title })}
          onClick={() => { onChange(option.id); }}
        >{option.label}</button>
      ))}
    </div>
  );
}

/**
 * The tool options bar: the active tool and its settings above the map, as in image editors. Brush shows its
 * materials first (swatch and paint for each layer it writes), then the target layers, size, shape, smoothing and
 * the footprint preview; Erase keeps the target, size and shape. Undo and redo sit at the end.
 */
export function ToolOptions({ commands: supplied }: { readonly commands?: readonly Command[] }): React.JSX.Element {
  const currentCommands = useCommands();
  const commands = supplied ?? currentCommands;
  const tool = useViewStore((state) => state.tool);
  const definition = TOOLS.find((candidate) => candidate.id === tool);
  const brush = useBrushStore();
  const brushWorld = useBrushStore((state) => state.world);
  // The brush's world version keys the loaded world's materials (read outside React).
  const materials = useMemo(() => loadedBrushMaterials(), [brushWorld]); // eslint-disable-line react-hooks/exhaustive-deps -- see above
  const editing = tool === "brush" || tool === "erase";
  const undo = commandById(commands, "edit.undo");
  const redo = commandById(commands, "edit.redo");
  const locked = brush.active || !commandById(commands, `tool.${tool}`).enabled;
  const layers = brushLayers(brush.layer);
  return (
    <div className="tool-options" role="region" aria-label="Tool options" data-editing={editing}>
      <span className="tool-options-identity">
        {definition !== undefined && <Icon name={definition.icon} />}
        <span className="tool-options-name">{definition?.label}</span>
      </span>
      {editing ? <>
        {tool === "brush" && (
          <div className="brush-option-group brush-option-materials" role="group" aria-label="Brush materials">
            {layers.map((layer) => (
              <span key={layer} className="material-slot" data-paint-only={brush.paintOnly}>
                {!brush.paintOnly && <MaterialChip layer={layer} materials={materials} disabled={locked} />}
                <PaintWell layer={layer} materials={materials} disabled={locked} />
              </span>
            ))}
            <IconButton
              icon="roller" label="Paint only" pressed={brush.paintOnly} disabled={locked}
              disabledReason={brush.reason ?? "Finish the stroke first"}
              onClick={() => { useBrushStore.setState({ paintOnly: !brush.paintOnly }); }}
            />
          </div>
        )}
        <div className="brush-option-group brush-layer-options">
          <Segments
            label="Brush layer" options={LAYER_OPTIONS} value={brush.layer} disabled={locked}
            onChange={(layer) => { finishBrush(); useBrushStore.setState({ layer }); }}
          />
        </div>
        <div className="brush-option-group brush-option-size">
          <label className="brush-field"><span className="brush-option-label">Size</span>
            <input
              className="brush-slider" aria-label="Brush size" aria-valuetext={`${String(brush.size)} tiles across`} type="range"
              min={BRUSH_SIZE.minimum} max={BRUSH_SIZE.maximum} step={1} value={brush.size} disabled={locked}
              onChange={(event) => { setBrushSize(Number(event.target.value)); }}
            />
          </label>
          <input
            className="brush-number" aria-label="Brush size in tiles" type="number" inputMode="numeric"
            min={BRUSH_SIZE.minimum} max={BRUSH_SIZE.maximum} step={1} value={brush.size} disabled={locked}
            title="Footprint width in tiles: a square's side or a circle's diameter ([ and ] change it)"
            onChange={(event) => { if (event.target.value !== "") setBrushSize(Number(event.target.value)); }}
          />
          <Segments
            label="Brush shape" value={brush.shape} disabled={locked}
            options={[
              { id: BRUSH_SHAPE.square, title: "Square brush", label: <span className="brush-shape-icon" data-shape="square" aria-hidden="true" /> },
              { id: BRUSH_SHAPE.circle, title: "Round brush", label: <span className="brush-shape-icon" data-shape="circle" aria-hidden="true" /> },
            ]}
            onChange={(shape) => { useBrushStore.setState({ shape }); }}
          />
        </div>
        <div className="brush-option-group brush-option-smoothing">
          <label className="brush-field"><span className="brush-option-label">Smoothing</span>
            <input
              className="brush-slider" aria-label="Brush smoothing" type="range" min={0} max={100} step={5} value={brush.smoothing} disabled={locked}
              aria-valuetext={brush.smoothing === 0 ? "Off" : `${String(brush.smoothing)} percent stabilization`}
              title="Stroke stabilizer: the brush trails the pointer for steadier lines; 0 turns it off"
              onChange={(event) => { useBrushStore.setState({ smoothing: Number(event.target.value) }); }}
            />
          </label>
          <output className="brush-smoothing-value">{brush.smoothing === 0 ? "Off" : `${String(brush.smoothing)}%`}</output>
          <IconButton icon="target" label="Brush outline" pressed={brush.placementPreview} onClick={() => { useBrushStore.setState({ placementPreview: !brush.placementPreview }); }} />
        </div>
        {brush.reason !== null && <span className="tool-options-notice">{brush.reason}</span>}
      </> : <span className="tool-options-hint">{definition?.hint}</span>}
      <div className="tool-options-history" role="group" aria-label="History">
        {[undo, redo].map((command) => <IconButton key={command.id} icon={command.id === undo.id ? "undo" : "redo"} label={command.label} shortcut={command.shortcut} disabled={!command.enabled} disabledReason={command.disabledReason} onClick={command.run} />)}
      </div>
    </div>
  );
}
