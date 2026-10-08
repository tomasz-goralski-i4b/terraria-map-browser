import { VisibilityRow } from "../ui/Toggle.js";

const LAYERS = ["Background", "Walls", "Blocks", "Liquids", "Wires"] as const;

/** The slot for layer visibility and, with editing, layer locks; the toggles themselves are not wired yet. */
export function LayersPanel(): React.JSX.Element {
  return (
    <div className="layers-panel">
      {LAYERS.map((layer) => (
        <VisibilityRow key={layer} label={layer} visible disabled onChange={() => undefined} />
      ))}
      <p className="panel-note">Layer toggles are not available yet.</p>
    </div>
  );
}

/** The slot for the pinned tile inspector (Inspect tool). Until then the status bar describes the hovered tile. */
export function InspectorPanel(): React.JSX.Element {
  return <p className="panel-empty">The status bar shows the tile under the pointer. Pinning a tile to inspect it is not available yet.</p>;
}

/** The slot for chests, signs and NPCs, listed with the same table as Content once those sections are decoded. */
export function EntitiesPanel(): React.JSX.Element {
  return <p className="panel-empty">Chests, signs and NPCs are listed here once their sections are decoded.</p>;
}
