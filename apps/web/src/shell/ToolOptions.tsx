import { TOOLS } from "./commands.js";
import { useViewStore } from "./view-store.js";

/**
 * The tool options bar: the active tool's name and settings, above the map (as in image and level editors). Edit
 * tools will put their settings here — brush size and shape, which layers they write (block, wall, paint, liquid,
 * wires) — so the map never needs a modal to change them.
 */
export function ToolOptions(): React.JSX.Element {
  const tool = useViewStore((state) => state.tool);
  const definition = TOOLS.find((candidate) => candidate.id === tool);
  return (
    <div className="tool-options" role="region" aria-label="Tool options">
      <span className="tool-options-name">{definition?.label}</span>
      <span className="muted">{definition?.hint}</span>
    </div>
  );
}
