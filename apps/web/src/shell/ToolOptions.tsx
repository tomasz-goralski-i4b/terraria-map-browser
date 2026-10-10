import { useEffect, useMemo, useRef, useState } from "react";
import { AreaOptions } from "./AreaOptions.js";
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
      <MaterialSwatch color={material?.color ?? null} paint={paintColor(materials, paint)} layer={layer} content={{ kind: "vanilla", id }} />
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
    const close = (): void => { setOpen(null); };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", close);
    document.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", close);
      document.removeEventListener("scroll", close, true);
    };
  }, [open]);
  const label = `${LAYER_NAMES[layer]} paint: ${paintLabel(materials, paint)}`;
  const tooltip = `${label} — click to choose the paint it is put down with`;
  const choose = (next: number): void => {
    chooseBrushPaint(next, [layer]);
    setOpen(null);
    button.current?.focus();
  };
  return (
    <div ref={root} className="paint-well">
      <button
        ref={button} type="button" className="paint-well-button" disabled={disabled} aria-label={label} aria-haspopup="dialog" aria-expanded={open !== null && materials !== null}
        data-tooltip={tooltip} data-tooltip-side="bottom" data-none={paint === 0}
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
          onBlur={(event) => { if (!(root.current?.contains(event.relatedTarget) ?? false)) setOpen(null); }}
        >
          <button type="button" className="paint-none" aria-pressed={paint === 0} autoFocus={paint === 0} onClick={() => { choose(0); }}>No paint</button>
          <div className="paint-grid" role="group" aria-label="Paints">
            {materials.paints.map((candidate) => (
              <button
                key={candidate.id} type="button" className="paint-cell" aria-label={candidate.name} data-tooltip={candidate.name} data-tooltip-side="bottom" aria-pressed={paint === candidate.id}
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
  /** `name` is the accessible name of an option without text; `tooltip` the app's tooltip (never a native title). */
  readonly options: readonly { readonly id: T; readonly label: React.ReactNode; readonly name?: string; readonly tooltip?: string }[];
  readonly value: T;
  readonly disabled: boolean;
  readonly onChange: (value: T) => void;
}): React.JSX.Element {
  return (
    <div className="brush-segments" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.id} type="button" aria-pressed={value === option.id} disabled={disabled}
          {...(option.name === undefined ? {} : { "aria-label": option.name })}
          {...(option.tooltip === undefined ? {} : { "data-tooltip": option.tooltip, "data-tooltip-side": "bottom" })}
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
  const locked = brush.active || !commandById(commands, `tool.${tool}`).enabled;
  const layers = brushLayers(brush.layer);
  return (
    <div className="tool-options" role="region" aria-label="Tool options" data-editing={editing || tool === "select"} data-selection={tool === "select"}>
      <span className="tool-options-identity">
        {definition !== undefined && <Icon name={definition.icon} />}
        <span className="tool-options-name">{definition?.label}</span>
      </span>
      {editing ? <>
        {tool === "brush" && (
          <div className="brush-option-group brush-option-materials" role="group" aria-label="Brush materials">
            <Segments
              label="Brush mode" value={brush.paintOnly ? "paint" : "place"} disabled={locked}
              options={[
                { id: "place", label: "Place", tooltip: "Place the material with its paint (R)" },
                { id: "paint", label: "Paint", tooltip: "Paint only: recolour what is there, like a paint roller (R)" },
              ]}
              onChange={(mode) => { useBrushStore.setState({ paintOnly: mode === "paint" }); }}
            />
            {layers.map((layer) => (
              <span key={layer} className="material-slot" data-paint-only={brush.paintOnly}>
                {!brush.paintOnly && <MaterialChip layer={layer} materials={materials} disabled={locked} />}
                <PaintWell layer={layer} materials={materials} disabled={locked} />
              </span>
            ))}
          </div>
        )}
        <div className="brush-option-group brush-layer-options">
          <Segments
            label="Brush layer" options={LAYER_OPTIONS.map((option) => ({ ...option, tooltip: option.id === BRUSH_LAYER.both ? "Blocks and walls together (Shift+X)" : `${option.label} only (X swaps blocks and walls)` }))}
            value={brush.layer} disabled={locked}
            onChange={(layer) => { finishBrush(); useBrushStore.setState({ layer }); }}
          />
        </div>
        <div className="brush-option-group brush-option-size">
          <label className="brush-field" data-tooltip="Size in tiles: a square's side or a circle's diameter ([ and ])" data-tooltip-side="bottom"><span className="brush-option-label">Size</span>
            <input
              className="brush-slider" aria-label="Brush size" aria-valuetext={`${String(brush.size)} tiles across`} type="range"
              min={BRUSH_SIZE.minimum} max={BRUSH_SIZE.maximum} step={1} value={brush.size} disabled={locked}
              onChange={(event) => { setBrushSize(Number(event.target.value)); }}
            />
          </label>
          <input
            className="brush-number" aria-label="Brush size in tiles" type="number" inputMode="numeric"
            min={BRUSH_SIZE.minimum} max={BRUSH_SIZE.maximum} step={1} value={brush.size} disabled={locked}
            onChange={(event) => { if (event.target.value !== "") setBrushSize(Number(event.target.value)); }}
          />
          <Segments
            label="Brush shape" value={brush.shape} disabled={locked}
            options={[
              { id: BRUSH_SHAPE.square, name: "Square brush", tooltip: "Square brush (Shift+B)", label: <span className="brush-shape-icon" data-shape="square" aria-hidden="true" /> },
              { id: BRUSH_SHAPE.circle, name: "Round brush", tooltip: "Round brush (Shift+B)", label: <span className="brush-shape-icon" data-shape="circle" aria-hidden="true" /> },
            ]}
            onChange={(shape) => { useBrushStore.setState({ shape }); }}
          />
        </div>
        <div className="brush-option-group brush-option-smooth">
          <IconButton
            icon="hammer" label="Smooth edges: hammer edges into slopes" shortcut="S" pressed={brush.smooth} disabled={locked || (tool === "brush" && brush.paintOnly) || brush.layer === BRUSH_LAYER.wall}
            disabledReason={brush.layer === BRUSH_LAYER.wall ? "Walls have no shape" : brush.paintOnly ? "Paint only changes no blocks" : brush.reason ?? "Finish the stroke first"}
            onClick={() => { useBrushStore.setState({ smooth: !brush.smooth }); }}
          />
        </div>
        <div className="brush-option-group brush-option-smoothing">
          <label className="brush-field" data-tooltip="Stabilizer: the brush trails the pointer for steadier lines; Off at 0" data-tooltip-side="bottom"><span className="brush-option-label">Stabilizer</span>
            <input
              className="brush-slider" aria-label="Brush stabilizer" type="range" min={0} max={100} step={5} value={brush.smoothing} disabled={locked}
              aria-valuetext={brush.smoothing === 0 ? "Off" : `${String(brush.smoothing)} percent stabilization`}
              onChange={(event) => { useBrushStore.setState({ smoothing: Number(event.target.value) }); }}
            />
          </label>
          <output className="brush-smoothing-value">{brush.smoothing === 0 ? "Off" : `${String(brush.smoothing)}%`}</output>
          <IconButton icon="target" label="Brush outline" pressed={brush.placementPreview} onClick={() => { useBrushStore.setState({ placementPreview: !brush.placementPreview }); }} />
        </div>
        {brush.reason !== null && <span className="tool-options-notice">{brush.reason}</span>}
      </> : tool === "select" ? <AreaOptions commands={commands} disabled={locked} /> : <span className="tool-options-hint">{definition?.hint}</span>}
      {/* Phones hide the top bar's Undo and Redo; the options bar carries them there. */}
      <div className="tool-options-history" role="group" aria-label="History">
        {(["edit.undo", "edit.redo"] as const).map((id) => {
          const command = commandById(commands, id);
          return <IconButton key={id} icon={id === "edit.undo" ? "undo" : "redo"} label={command.label} shortcut={command.shortcut} disabled={!command.enabled} disabledReason={command.disabledReason} onClick={command.run} />;
        })}
      </div>
    </div>
  );
}
