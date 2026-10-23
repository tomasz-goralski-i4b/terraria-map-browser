import { useId, useMemo } from "react";
import { Icon, type IconName } from "../ui/Icon.js";
import { Segments } from "../ui/Segments.js";
import { Toggle } from "./LayerToggles.js";
import { useModal } from "./dialogs.js";
import { plannedReason } from "./commands.js";
import { useViewStore, type PlannedDialog } from "./view-store.js";

interface DialogShell {
  readonly title: string;
  readonly action: string;
  /** What the feature is called in its disabled reason. */
  readonly feature: string;
  readonly fields: () => React.JSX.Element;
  readonly facts: readonly (readonly [IconName, string])[];
}

const off = (): void => undefined;

function Field({ label, children }: { readonly label: string; readonly children: React.ReactNode }): React.JSX.Element {
  return <div className="save-field"><span className="save-field-label">{label}</span><div className="dialog-field-value">{children}</div></div>;
}

function Choice({ label, options }: { readonly label: string; readonly options: readonly string[] }): React.JSX.Element {
  return <Segments label={label} value={options[0] ?? ""} disabled options={options.map((option) => ({ id: option, label: option }))} onChange={off} />;
}

function Layers({ names }: { readonly names: readonly string[] }): React.JSX.Element {
  return (
    <div className="brush-segments layer-toggles">
      {names.map((name) => <Toggle key={name} label={name} tooltip={name} pressed disabled onChange={off} />)}
    </div>
  );
}

const SHELLS: Readonly<Record<PlannedDialog, DialogShell>> = {
  replace: {
    title: "Replace", action: "Replace", feature: "Replace",
    fields: () => <>
      <Field label="Find"><input className="text-input" disabled placeholder="Block, wall or paint" /></Field>
      <Field label="Replace with"><input className="text-input" disabled placeholder="Block, wall or paint" /></Field>
      <Field label="In"><Choice label="Scope" options={["Whole world", "Selection"]} /></Field>
      <Field label="Layers"><Layers names={["Blocks", "Walls", "Paint"]} /></Field>
    </>,
    facts: [["search", "Counted before anything changes"], ["lock", "Shapes, wires and chests stay as they are"], ["undo", "One step to undo"]],
  },
  importImage: {
    title: "Import Image as Pixel Art", action: "Place as paste", feature: "Image import",
    fields: () => <>
      <Field label="Image"><button type="button" className="button button-small" disabled><Icon name="image" />Choose Image…</button><span className="muted">PNG, JPEG or WebP</span></Field>
      <Field label="Size">
        <input className="text-input dialog-number" disabled placeholder="64" aria-label="Width in blocks" /><span className="muted">×</span>
        <input className="text-input dialog-number" disabled placeholder="64" aria-label="Height in blocks" /><span className="muted">blocks</span>
        <Icon name="lock" />
      </Field>
      <Field label="Build with"><Choice label="Target" options={["Blocks", "Walls", "Both"]} /></Field>
      <Field label="Transparent"><Choice label="Transparent pixels" options={["Keep what is there", "Clear", "Background"]} /></Field>
      <div className="dialog-previews">
        <figure><div className="dialog-preview" /><figcaption>Map colours</figcaption></figure>
        <figure><div className="dialog-preview" /><figcaption>Textured</figcaption></figure>
      </div>
    </>,
    facts: [["object", "Vanilla solid blocks, walls and paints only"], ["select", "Placed as a paste you can move before it is written"]],
  },
  exportImage: {
    title: "Export Map Image", action: "Export", feature: "Map image export",
    fields: () => <>
      <Field label="Area"><Choice label="Area" options={["Whole world", "View", "Selection"]} /></Field>
      <Field label="Scale">
        <select className="text-input" disabled aria-label="Pixels per block"><option>1 pixel per block</option></select>
      </Field>
      <Field label="Layers"><Layers names={["Background", "Walls", "Blocks", "Liquids", "Wires"]} /></Field>
      <Field label="Size"><span className="muted">8400 × 2400 px · about 12 MB</span></Field>
    </>,
    facts: [["image", "PNG, drawn as the map shows it"], ["check", "Runs in the background; you can keep working"]],
  },
  saveSchematic: {
    title: "Save Selection as Schematic", action: "Save", feature: "Schematics",
    fields: () => <>
      <Field label="Name"><input className="text-input" disabled placeholder="Starter house" /></Field>
      <Field label="Tags"><input className="text-input" disabled placeholder="house, forest" /></Field>
      <Field label="Anchor"><Choice label="Anchor" options={["Top left", "Bottom centre", "Centre"]} /></Field>
      <div className="dialog-previews"><figure><div className="dialog-preview" /><figcaption>Thumbnail</figcaption></figure></div>
    </>,
    facts: [["schematic", "Stored in this browser's library"], ["object", "Chests and signs are saved with their contents"]],
  },
};

/** The shells of dialogs whose action is not connected yet: they show what they will ask, and say why they cannot run. */
export function PlannedDialogs(): React.JSX.Element {
  const dialog = useViewStore((state) => state.plannedDialog);
  const setDialog = useViewStore((state) => state.setPlannedDialog);
  const close = useMemo(() => () => { setDialog(null); }, [setDialog]);
  const ref = useModal(dialog !== null, close);
  const titleId = useId();
  const shell = dialog === null ? null : SHELLS[dialog];
  const reason = shell === null ? "" : `${shell.feature}: ${plannedReason().toLowerCase()}`;
  return (
    <dialog ref={ref} className="dialog save-dialog planned-dialog" aria-labelledby={titleId}>
      <header className="dialog-header">
        <h2 id={titleId}>{shell?.title}</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={close}><Icon name="close" /></button>
      </header>
      {shell !== null && (
        <div className="save-body">
          {shell.fields()}
          <ul className="save-facts" aria-label="What it does">
            {shell.facts.map(([icon, text]) => <li key={text}><Icon name={icon} />{text}</li>)}
          </ul>
          <p className="save-notice save-notice-warning"><Icon name="info" /><span>{reason}.</span></p>
          <footer className="dialog-footer">
            <span className="dialog-footer-spacer" />
            <button type="button" className="button" onClick={close}>Cancel</button>
            <button type="button" className="button button-primary" aria-disabled data-tooltip={reason} data-tooltip-side="top">{shell.action}</button>
          </footer>
        </div>
      )}
    </dialog>
  );
}
