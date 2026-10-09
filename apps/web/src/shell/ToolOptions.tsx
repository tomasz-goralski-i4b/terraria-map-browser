import { TOOLS } from "./commands.js";
import { useViewStore } from "./view-store.js";
import { BRUSH_BLOCKS, BRUSH_WALLS } from "@studio/world-model";
import { finishBrush, redoBrush, undoBrush, useBrushStore } from "../world/brush-session.js";
import { useAppStore } from "../store.js";
import { useSaveStore } from "../world/save-world.js";

const MATERIAL_NAMES = ["Dirt", "Stone", "Wood", "Gray brick"];

/**
 * The tool options bar: the active tool's name and settings, above the map (as in image and level editors). Edit
 * tools will put their settings here — brush size and shape, which layers they write (block, wall, paint, liquid,
 * wires) — so the map never needs a modal to change them.
 */
export function ToolOptions(): React.JSX.Element {
  const tool = useViewStore((state) => state.tool);
  const definition = TOOLS.find((candidate) => candidate.id === tool);
  const brush = useBrushStore();
  const editing = tool === "brush" || tool === "erase";
  const loading = useAppStore((state) => state.phase === "loading");
  const saving = useSaveStore((state) => state.open);
  const locked = loading || saving || brush.reason !== null;
  return (
    <div className="tool-options" role="region" aria-label="Tool options">
      <span className="tool-options-name">{definition?.label}</span>
      <span className="muted">{definition?.hint}</span>
      {editing && <>
        <label>Layer <select aria-label="Brush layer" value={brush.layer} disabled={brush.active} onChange={(event) => {
          finishBrush(true);
          useBrushStore.setState({ layer: event.target.value === "wall" ? "wall" : "block" });
        }}><option value="block">Blocks</option><option value="wall">Walls</option></select></label>
        {tool === "brush" && <label>Material <select aria-label="Brush material" value={brush.layer === "block" ? brush.blockId : brush.wallId} disabled={brush.active} onChange={(event) => {
          useBrushStore.setState(brush.layer === "block" ? { blockId: Number(event.target.value) } : { wallId: Number(event.target.value) });
        }}>{(brush.layer === "block" ? BRUSH_BLOCKS : BRUSH_WALLS).map((id, index) => <option key={id} value={id}>{MATERIAL_NAMES[index]}</option>)}</select></label>}
        <label>Size <input aria-label="Brush size" type="number" min={1} max={9} step={1} value={brush.size} disabled={brush.active} onChange={(event) => {
          const size = Number(event.target.value);
          if (Number.isInteger(size) && size >= 1 && size <= 9) useBrushStore.setState({ size });
        }} /></label>
        {brush.reason !== null && <span className="muted">{brush.reason}</span>}
      </>}
      <button type="button" className="button" disabled={!brush.canUndo || locked} onClick={undoBrush}>Undo</button>
      <button type="button" className="button" disabled={!brush.canRedo || locked} onClick={redoBrush}>Redo</button>
    </div>
  );
}
