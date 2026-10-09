import { BRUSH_LAYER, BRUSH_SHAPE } from "@studio/world-model";
import { Icon } from "../ui/Icon.js";
import { IconButton } from "../ui/IconButton.js";
import { finishBrush, useBrushStore } from "../world/brush-session.js";
import { BRUSH_LAYER_OPTIONS, BRUSH_MATERIAL_FIELDS, BRUSH_MATERIALS, BRUSH_SIZE } from "./brush-settings.js";
import { commandById, TOOLS, useCommands, type Command } from "./commands.js";
import { useViewStore } from "./view-store.js";

/** Compact editor options with visible stroke settings and shared history commands. */
export function ToolOptions({ commands: supplied }: { readonly commands?: readonly Command[] }): React.JSX.Element {
  const currentCommands = useCommands();
  const commands = supplied ?? currentCommands;
  const tool = useViewStore((state) => state.tool);
  const definition = TOOLS.find((candidate) => candidate.id === tool);
  const brush = useBrushStore();
  const editing = tool === "brush" || tool === "erase";
  const undo = commandById(commands, "edit.undo");
  const redo = commandById(commands, "edit.redo");
  const locked = brush.active || !commandById(commands, `tool.${tool}`).enabled;
  const materials = brush.layer === BRUSH_LAYER.both ? [BRUSH_LAYER.block, BRUSH_LAYER.wall] : [brush.layer];
  return (
    <div className="tool-options" role="region" aria-label="Tool options" data-editing={editing}>
      <span className="tool-options-identity">
        {definition !== undefined && <Icon name={definition.icon} />}
        <span className="tool-options-name">{definition?.label}</span>
      </span>
      {editing ? <>
        <div className="brush-option-group brush-layer-options" role="group" aria-label="Brush layer">
          <span className="brush-option-label">Target</span>
          <div className="brush-segments">
            {BRUSH_LAYER_OPTIONS.map(({ id, label }) => <button key={id} type="button" aria-pressed={brush.layer === id} disabled={locked} onClick={() => {
              finishBrush(true);
              useBrushStore.setState({ layer: id });
            }}>{label}</button>)}
          </div>
        </div>
        {tool === "brush" && <div className="brush-option-group brush-option-materials" role="group" aria-label="Brush materials">
          {materials.map((layer) => <label className="brush-field" key={layer}>
            <span className="brush-option-label">{BRUSH_MATERIAL_FIELDS[layer].label}</span>
            <select className="select brush-material" aria-label={BRUSH_MATERIAL_FIELDS[layer].accessibleName} value={brush[BRUSH_MATERIAL_FIELDS[layer].idKey]} disabled={locked} onChange={(event) => {
              useBrushStore.setState(layer === BRUSH_LAYER.block ? { blockId: Number(event.target.value) } : { wallId: Number(event.target.value) });
            }}>{BRUSH_MATERIALS.map((material) => <option key={material.label} value={layer === BRUSH_LAYER.block ? material.blockId : material.wallId}>{material.label}</option>)}</select>
          </label>)}
        </div>}
        <div className="brush-option-group brush-option-size">
          <label className="brush-field"><span className="brush-option-label">Size</span>
            <input className="brush-slider" aria-label="Brush size" aria-valuetext={`${String(brush.size)} world tiles across`} title="Footprint width in world tiles; circle size is its diameter" type="range" min={BRUSH_SIZE.minimum} max={BRUSH_SIZE.maximum} step={1} value={brush.size} disabled={locked} onChange={(event) => {
              const size = Number(event.target.value);
              if (Number.isInteger(size) && size >= BRUSH_SIZE.minimum && size <= BRUSH_SIZE.maximum) useBrushStore.setState({ size });
            }} />
          </label>
          <output className="brush-size-value" title="World tiles across">{brush.size} {brush.size === 1 ? "tile" : "tiles"}</output>
        </div>
        <div className="brush-option-group brush-option-shape" role="group" aria-label="Brush shape">
          <div className="brush-segments">
            {[BRUSH_SHAPE.square, BRUSH_SHAPE.circle].map((shape) => <button key={shape} type="button" aria-label={shape === BRUSH_SHAPE.square ? "Square brush" : "Round brush"} title={shape === BRUSH_SHAPE.square ? "Square brush" : "Round brush"} aria-pressed={brush.shape === shape} disabled={locked} onClick={() => { useBrushStore.setState({ shape }); }}><span className="brush-shape-icon" data-shape={shape} aria-hidden="true" /></button>)}
          </div>
        </div>
        <div className="brush-option-group brush-option-smoothing">
          <label className="brush-field"><span className="brush-option-label">Smoothing</span>
            <input className="brush-slider" aria-label="Brush smoothing" aria-valuetext={brush.smoothing === 0 ? "Off" : `${String(brush.smoothing)} percent stabilization`} title="Delayed cursor tracking for steadier lines; 0 turns it off" type="range" min={0} max={100} step={5} value={brush.smoothing} disabled={locked} onChange={(event) => { useBrushStore.setState({ smoothing: Number(event.target.value) }); }} />
          </label>
          <output className="brush-smoothing-value">{brush.smoothing === 0 ? "Off" : `${String(brush.smoothing)}%`}</output>
        </div>
        <div className="brush-option-group brush-option-preview">
          <IconButton icon="target" label="Placement preview" pressed={brush.placementPreview} onClick={() => { useBrushStore.setState({ placementPreview: !brush.placementPreview }); }} />
        </div>
        {brush.reason !== null && <span className="tool-options-notice">{brush.reason}</span>}
      </> : <span className="tool-options-hint">{definition?.hint}</span>}
      <div className="tool-options-history" role="group" aria-label="History">
        {[undo, redo].map((command) => <IconButton key={command.id} icon={command.id === undo.id ? "undo" : "redo"} label={command.label} shortcut={command.shortcut} disabled={!command.enabled} disabledReason={command.disabledReason} onClick={command.run} />)}
      </div>
    </div>
  );
}
