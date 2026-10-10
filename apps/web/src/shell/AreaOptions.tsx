import { useAreaStore } from "../world/area-session.js";
import type { CopyLayers, PasteOptions } from "../world/area-clipboard.js";
import { type Command, commandById } from "./commands.js";

const LAYERS: readonly (readonly [keyof CopyLayers, string])[] = [["blocks", "Blocks"], ["walls", "Walls"], ["liquids", "Liquids"], ["wires", "Wires / actuators"], ["paint", "Paint"], ["objects", "Objects / entities"]];
const OPTIONS: readonly { readonly key: keyof PasteOptions; readonly label: string; readonly choices: readonly string[] }[] = [
  { key: "air", label: "Air", choices: ["replace", "transparent"] }, { key: "walls", label: "Walls", choices: ["replace", "keep"] }, { key: "liquids", label: "Liquids", choices: ["replace", "merge"] },
];
export function AreaOptions({ commands, disabled }: { readonly commands: readonly Command[]; readonly disabled: boolean }): React.JSX.Element {
  const state = useAreaStore();
  return <>
    {!state.pasting && <div className="brush-option-group area-layer-options" role="group" aria-label="Copy layers">
      <span className="brush-option-label">Copy</span>
      {LAYERS.map(([key, label]) => <label key={key} className="brush-field"><input type="checkbox" checked={state.layers[key] && (key !== "objects" || state.layers.blocks)} aria-describedby={key === "objects" && !state.layers.blocks ? "objects-requires-blocks" : undefined} disabled={disabled || state.pasting || (key === "objects" && !state.layers.blocks)} onChange={(event) => { useAreaStore.setState({ layers: { ...state.layers, [key]: event.target.checked } }); }} />{label}</label>)}
      {!state.layers.blocks && <span id="objects-requires-blocks" className="tool-options-hint">Objects / entities: Requires Blocks</span>}
    </div>}
    {state.pasting && <div className="brush-option-group" role="group" aria-label="Paste options">
      {OPTIONS.map(({ key, label, choices }) => <label key={key} className="brush-field">{label}<select aria-label={`Paste ${key}`} disabled={disabled} value={state.options[key]} onChange={(event) => {
        const value = event.target.value;
        const options = state.options;
        useAreaStore.setState({ options: key === "air" ? { ...options, air: value === "transparent" ? "transparent" : "replace" } : key === "walls" ? { ...options, walls: value === "keep" ? "keep" : "replace" } : { ...options, liquids: value === "merge" ? "merge" : "replace" } });
      }}>{choices.map((value) => <option key={value} value={value}>{value === "merge" ? "Merge same kind" : value[0]?.toUpperCase()}{value === "merge" ? "" : value.slice(1)}</option>)}</select></label>)}
    </div>}
    <div className="brush-option-group" role="group" aria-label="Selection actions">
      {(state.pasting ? ["edit.placePaste", "edit.cancelArea"] : ["edit.copy", "edit.paste", ...(state.selection === null ? [] : ["edit.cancelArea"])]).map((id) => {
        const command = commandById(commands, id);
        return <button key={id} type="button" className="button" disabled={!command.enabled} title={command.disabledReason ?? command.shortcut} onClick={command.run}>{command.label}</button>;
      })}
    </div>
    <span className="tool-options-hint" role="status">{state.message ?? (state.selection === null ? "Drag a rectangle · Ctrl+C / Ctrl+V" : `${String(state.selection.width)} × ${String(state.selection.height)} tiles`)}</span>
  </>;
}
