import { useRulerStore, changeMeasurement, deleteMeasurement, clearMeasurements, selectMeasurement } from "../world/ruler-session.js";
import { measurementDimensions, measurementLength, measurementSummary } from "../world/measurements.js";
import { getMapController } from "../shell/view-store.js";
import { IconButton } from "../ui/IconButton.js";
import { PropertyGrid } from "../ui/PropertyGrid.js";

export function MeasurementsPanel(): React.JSX.Element {
  const items = useRulerStore((state) => state.items);
  const selectedId = useRulerStore((state) => state.selected);
  const selected = items.find((item) => item.id === selectedId);
  const size = selected === undefined ? null : measurementDimensions(selected);
  return <div className="measurements-panel" role="group" aria-label="Measurements">
    {items.length === 0 ? <p className="panel-empty">Choose Ruler (L) and drag to measure.</p> : <>
      <div className="measurement-list-actions"><span className="muted">{items.length} {items.length === 1 ? "measurement" : "measurements"}</span>
        <IconButton icon="close" label="Clear measurements" onClick={clearMeasurements} /></div>
      <ul className="measurement-list">
        {items.map((item) => {
          return <li key={item.id} data-selected={selectedId === item.id} data-visible={item.visible}>
            <IconButton icon={item.visible ? "eye" : "eyeOff"} label={`Show ${item.name}`} pressed={item.visible} onClick={() => { changeMeasurement(item.id, { visible: !item.visible }); }} />
            <button type="button" className="measurement-pick" aria-pressed={selectedId === item.id} onClick={() => {
              selectMeasurement(item.id);
              getMapController()?.centerOn((item.start.x + item.end.x) / 2, (item.start.y + item.end.y) / 2);
            }}><span>{item.name}</span><span className="muted">{measurementSummary(item)}</span></button>
            <IconButton icon="close" label={`Delete ${item.name}`} onClick={() => { deleteMeasurement(item.id); }} />
          </li>;
        })}
      </ul>
    </>}
    {selected !== undefined && size !== null && <PropertyGrid label="Selected measurement" properties={[
      { kind: "custom", label: "Name", value: <input key={`${String(selected.id)}:${selected.name}`} className="text-input measurement-name" aria-label="Measurement name" defaultValue={selected.name} maxLength={80}
        onBlur={(event) => { if (event.target.value.trim() !== selected.name) changeMeasurement(selected.id, { name: event.target.value }); }}
        onKeyDown={(event) => { if (event.key === "Enter") event.currentTarget.blur(); }} /> },
      { kind: "text", label: "Start", value: `${String(selected.start.x)}, ${String(selected.start.y)}` },
      { kind: "text", label: "End", value: `${String(selected.end.x)}, ${String(selected.end.y)}` },
      { kind: "text", label: "Size", value: `${String(size.width)} × ${String(size.height)} blocks` },
      ...(selected.kind === "rectangle" ? [{ kind: "text" as const, label: "Area", value: `${(size.width * size.height).toLocaleString("en-US")} blocks` }] : [
        { kind: "text" as const, label: "Length", value: `${size.length.toFixed(2)} (straight)` },
        { kind: "text" as const, label: "Blocks on path", value: String(measurementLength(selected)) },
        { kind: "text" as const, label: "Angle", value: `${size.angle.toFixed(1)}°` },
      ]),
    ]} />}
  </div>;
}
