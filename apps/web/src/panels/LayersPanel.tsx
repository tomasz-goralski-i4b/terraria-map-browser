import { WIRE_COLORS, WIRE_LAYER } from "@studio/renderer";
import { commandById, LAYER_TOGGLES, layerShown, type Command } from "../shell/commands.js";
import { useViewStore } from "../shell/view-store.js";
import { VisibilityRow } from "../ui/Toggle.js";

const WIRE_ROWS: readonly { readonly bit: number; readonly label: string }[] = [
  { bit: WIRE_LAYER.red, label: "Red wire" },
  { bit: WIRE_LAYER.blue, label: "Blue wire" },
  { bit: WIRE_LAYER.green, label: "Green wire" },
  { bit: WIRE_LAYER.yellow, label: "Yellow wire" },
  { bit: WIRE_LAYER.actuator, label: "Actuators" },
];

function swatch(bit: number): React.CSSProperties {
  const [r, g, b] = WIRE_COLORS.find(([candidate]) => candidate === bit)?.[1] ?? [0, 0, 0];
  return { backgroundColor: `rgb(${String(r)} ${String(g)} ${String(b)})` };
}

/**
 * Layer visibility (eye rows). Toggling a layer changes a renderer uniform only: no chunk is re-uploaded or re-parsed.
 * With editing, each row also gets a lock (docs/ui.md).
 */
export function LayersPanel({ commands }: { readonly commands: readonly Command[] }): React.JSX.Element {
  const layers = useViewStore((state) => state.layers);
  const setLayers = useViewStore((state) => state.setLayers);
  return (
    <div className="layers-panel" role="group" aria-label="Map layers">
      {LAYER_TOGGLES.map(({ layer, label, shortcut }) => {
        const command = commandById(commands, `layer.${layer}`);
        return (
          <div key={layer}>
            <VisibilityRow label={label} visible={layerShown(layers, layer)} shortcut={shortcut} onChange={command.run} />
            {layer === "wires" && (
              <div className="visibility-children" role="group" aria-label="Wire colours">
                {WIRE_ROWS.map(({ bit, label: wireLabel }) => (
                  <VisibilityRow
                    key={bit}
                    label={wireLabel}
                    visible={(layers.wires & bit) !== 0}
                    onChange={(visible) => {
                      setLayers({ wires: visible ? layers.wires | bit : layers.wires & ~bit });
                    }}
                  >
                    <span className="swatch" style={swatch(bit)} aria-hidden="true" />
                  </VisibilityRow>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
