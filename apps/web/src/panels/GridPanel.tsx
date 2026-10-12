import { GRID_MODES, useLayoutStore } from "../shell/layout-store.js";
import { PropertyGrid } from "../ui/PropertyGrid.js";

export const CUSTOM_GRID_INPUT_ID = "custom-grid-spacing";

/** View > Grid choices with a custom interval and opacity shared by both line styles. */
export function GridPanel(): React.JSX.Element {
  const grid = useLayoutStore((state) => state.grid);
  const setGrid = useLayoutStore((state) => state.setGrid);
  return <div className="grid-panel">
    <PropertyGrid label="Grid settings" properties={[
      { kind: "custom", label: "Spacing", value: <div className="grid-spacing" title="Dashed every block; solid at the selected spacing. Visible at sprite zoom."><select className="select" aria-label="Grid spacing" value={String(grid.mode)} onChange={(event) => {
        const mode = GRID_MODES.find((choice) => String(choice) === event.target.value);
        if (mode !== undefined) setGrid({ mode });
      }}>{GRID_MODES.map((mode) => <option key={mode} value={String(mode)}>{mode === "off" ? "Off" : mode === "custom" ? "Custom" : String(mode)}</option>)}</select>
        <input key={grid.customSpacing} id={CUSTOM_GRID_INPUT_ID} className="text-input" aria-label="Custom grid spacing" type="number" min={2} max={1000} step={1}
          disabled={grid.mode !== "custom"} title="Custom spacing: 2–1000 blocks"
          defaultValue={grid.customSpacing} onBlur={(event) => {
            const value = event.target.valueAsNumber;
            if (Number.isInteger(value) && value >= 2 && value <= 1000) setGrid({ customSpacing: value });
            else event.target.value = String(grid.customSpacing);
          }}
          onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} />
        <span className="muted">blocks</span>
      </div> },
      { kind: "custom", label: "Opacity", value: <div className="grid-opacity">
        <input className="brush-slider" aria-label="Grid opacity" type="range" min={0} max={100} step={1} value={grid.opacity}
          aria-valuetext={`${String(grid.opacity)} percent`} onChange={(event) => { setGrid({ opacity: Number(event.target.value) }); }} />
        <output>{grid.opacity}%</output>
      </div> },
    ]} />
  </div>;
}
