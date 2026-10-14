import { useLayoutStore } from "./layout-store.js";
import { Toggle } from "./LayerToggles.js";
import { Segments } from "../ui/Segments.js";
import { MenuButton, type MenuItem } from "../ui/Menu.js";
import { useRulerStore } from "../world/ruler-session.js";

export function RulerOptions(): React.JSX.Element {
  const settings = useLayoutStore((state) => state.ruler);
  const setRuler = useLayoutStore((state) => state.setRuler);
  const draftKind = useRulerStore((state) => state.draft?.kind ?? null);
  const labels: MenuItem[] = ([["dimensions", "Dimensions"], ["components", "Horizontal / vertical components"], ["angle", "Angle to horizontal"]] as const)
    .map(([key, label]) => ({ kind: "check", label, checked: settings[key], onChange: (value) => { setRuler({ [key]: value }); } }));
  return <>
    <div className="brush-option-group"><Segments label="Measurement shape" value={draftKind ?? settings.mode} disabled={false}
      options={[{ id: "line", label: "Line", tooltip: "Drag a line; hold Shift for a rectangle" }, { id: "rectangle", label: "Rectangle", tooltip: "Drag opposite corners" }]}
      onChange={(mode) => { setRuler({ mode }); }} /></div>
    <div className="brush-option-group"><div className="brush-segments"><Toggle label="Keep" tooltip="Keep earlier measurements; off replaces them when a new measurement is finished"
      pressed={settings.keep} disabled={false} onChange={(keep) => { setRuler({ keep }); }} /></div></div>
    <div className="brush-option-group"><MenuButton label="Labels" items={labels} /></div>
    <span className="tool-options-hint">Drag to measure · Shift: rectangle · Drag handles to resize · Esc: cancel</span>
  </>;
}
