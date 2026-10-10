import { useState } from "react";
import { propertyOptions, propertyText, setWorldProperty, setPropertyDraft } from "../world/world-properties.js";

/** A committed edit updates the session; invalid drafts stay beside their error and never reach the world. */
export function WorldPropertyInput({ path, value, label, disabled }: {
  readonly path: string; readonly value: unknown; readonly label: string; readonly disabled: boolean;
}): React.JSX.Element {
  const [draft, setDraft] = useState(propertyText(value));
  const [error, setError] = useState<string | null>(null);
  const choices = propertyOptions(path, value);
  const date = path.endsWith(".creationTime") || path.endsWith(".lastPlayed");
  const commit = (text: string): void => {
    if (text === propertyText(value)) { setError(null); setPropertyDraft(path, null); return; }
    try { setWorldProperty(path, text); setError(null); setPropertyDraft(path, null); }
    catch (failure) { setPropertyDraft(path, text); setError(failure instanceof Error ? failure.message : String(failure)); }
  };
  return (
    <span className="property-editor">
      {typeof value === "boolean" ? (
        <input type="checkbox" aria-label={label} checked={value} disabled={disabled} onChange={(event) => { commit(String(event.target.checked)); }} />
      ) : Array.isArray(value) ? (
        <PropertyList path={path} values={value as readonly unknown[]} label={label} disabled={disabled} commit={commit} />
      ) : date ? (
        <input type="datetime-local" step="0.001" className="text-input" aria-label={label} aria-invalid={error !== null} disabled={disabled}
          title={String(value).endsWith("Z") ? "UTC" : "Unspecified time zone"}
          value={draft.replace(/Z$/, "")} onChange={(event) => {
            const input = event.target.value;
            const seconds = input.length === 16 ? `${input}:00` : input;
            const normalized = seconds.length === 19 ? `${seconds}.000` : seconds.includes(".") ? seconds.slice(0, 20) + seconds.slice(20).padEnd(3, "0") : seconds;
            const text = normalized + (String(value).endsWith("Z") ? "Z" : "");
            setDraft(text); setPropertyDraft(path, text);
          }} onBlur={() => { commit(draft); }} />
      ) : choices === undefined ? (
        <input type={typeof value === "number" ? "number" : "text"} step="any" className="text-input" aria-label={label} aria-invalid={error !== null} disabled={disabled}
          value={draft} onChange={(event) => { setDraft(event.target.value); setPropertyDraft(path, event.target.value); }}
          onBlur={() => { commit(draft); }} onKeyDown={(event) => {
            if (event.key === "Enter") { event.preventDefault(); commit(draft); }
            if (event.key === "Escape") { event.preventDefault(); setDraft(propertyText(value)); setError(null); setPropertyDraft(path, null); }
          }} />
      ) : (
        <select className="select" aria-label={label} disabled={disabled} value={propertyText(value)} onChange={(event) => { commit(event.target.value); }}>
          {!choices.some((choice) => String(choice.value) === propertyText(value)) && <option value={propertyText(value)} disabled>Stored: {propertyText(value)}</option>}
          {choices.map((choice) => <option key={String(choice.value)} value={String(choice.value)}>{choice.label}</option>)}
        </select>
      )}
      {error !== null && <span className="field-error" role="alert">{error}</span>}
    </span>
  );
}

function PropertyList({ path, values, label, disabled, commit }: {
  readonly path: string; readonly values: readonly unknown[]; readonly label: string; readonly disabled: boolean; readonly commit: (text: string) => void;
}): React.JSX.Element {
  const fixed = ["treeX", "treeStyles", "caveBackX", "caveBackStyles", "additionalTreeBackgrounds", "treeTopVariations"].includes(path.split(".").at(-1) ?? "");
  const [expanded, setExpanded] = useState(values.length <= 16);
  const update = (index: number, value: unknown): void => { commit(JSON.stringify(values.map((item, position) => position === index ? value : item))); };
  const draft = (index: number, value: unknown): void => { setPropertyDraft(path, JSON.stringify(values.map((item, position) => position === index ? value : item))); };
  return <span className="property-list">
    {values.length > 16 && <button type="button" className="button" aria-expanded={expanded} onClick={() => { setExpanded(!expanded); }}>{values.length} entries {expanded ? "▴" : "▾"}</button>}
    {values.length === 0 && <span className="muted">None</span>}
    {expanded && values.map((value, index) => {
      const choices = propertyOptions(`${path}.${String(index)}`, value);
      const name = `${label} ${String(index + 1)}`;
      return <span className="property-list-item" key={index}>
        <span className="numeric muted">{index + 1}</span>
        {typeof value === "object" && value !== null ? (["x", "y"] as const).map((axis) => <input className="text-input" type="number" step="1" aria-label={`${name} ${axis}`} disabled={disabled}
          key={axis} defaultValue={String((value as Record<string, unknown>)[axis])}
          onChange={(event) => { draft(index, { ...value, [axis]: event.target.value === "" ? NaN : Number(event.target.value) }); }}
          onBlur={(event) => { update(index, { ...value, [axis]: event.target.value === "" ? NaN : Number(event.target.value) }); }} />)
          : choices !== undefined ? <select className="select" aria-label={name} disabled={disabled} value={String(value)} onChange={(event) => { update(index, Number(event.target.value)); }}>
            {!choices.some((choice) => String(choice.value) === String(value)) && <option disabled value={String(value)}>Stored: {String(value)}</option>}
            {choices.map((choice) => <option key={String(choice.value)} value={String(choice.value)}>{choice.label}</option>)}
          </select> : <input className="text-input" type={typeof value === "number" ? "number" : "text"} step="1" aria-label={name} disabled={disabled} defaultValue={String(value)}
            onChange={(event) => { draft(index, typeof value === "number" ? event.target.value === "" ? NaN : Number(event.target.value) : event.target.value); }}
            onBlur={(event) => { update(index, typeof value === "number" ? event.target.value === "" ? NaN : Number(event.target.value) : event.target.value); }} />}
        {!fixed && <button type="button" className="icon-button" aria-label={`Remove ${name}`} disabled={disabled} onClick={() => { commit(JSON.stringify(values.filter((_, position) => position !== index))); }}>−</button>}
      </span>;
    })}
    {expanded && !fixed && <button type="button" className="button" aria-label={`Add ${label}`} disabled={disabled} onClick={() => { commit(JSON.stringify([...values, path.endsWith(".anglerFinishers") ? "" : path.endsWith(".teamSpawns") ? { x: 0, y: 0 } : 0])); }}>Add</button>}
  </span>;
}
