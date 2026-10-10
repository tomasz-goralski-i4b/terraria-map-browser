import { PASTE_ANCHORS, useAreaStore, type PasteAnchor } from "../world/area-session.js";
import type { CopyLayers, PasteOptions } from "../world/area-clipboard.js";
import { shortcutText } from "../ui/IconButton.js";
import { TOOLS, type Command, commandById } from "./commands.js";

const LAYERS: readonly { readonly key: keyof CopyLayers; readonly label: string; readonly tooltip: string }[] = [
  { key: "blocks", label: "Blocks", tooltip: "Blocks with their shape and actuation" },
  { key: "walls", label: "Walls", tooltip: "Walls" },
  { key: "liquids", label: "Liquids", tooltip: "Water, lava, honey and shimmer" },
  { key: "wires", label: "Wires", tooltip: "Wires and actuators" },
  { key: "paint", label: "Paint", tooltip: "Paint and coatings of blocks and walls" },
  { key: "objects", label: "Objects", tooltip: "Whole objects with their chests, signs and tile entities" },
];

/** Off, the whole rectangle replaces what is there, empty cells included; each toggle lets part of the destination through. */
const PASTE_TOGGLES: readonly { readonly label: string; readonly tooltip: string; readonly on: (options: PasteOptions) => boolean; readonly set: (options: PasteOptions, on: boolean) => PasteOptions }[] = [
  { label: "Skip empty blocks", tooltip: "Where the copy has no block, the block already there stays", on: (options) => options.air === "transparent", set: (options, on) => ({ ...options, air: on ? "transparent" : "replace" }) },
  { label: "Skip empty walls", tooltip: "Where the copy has no wall, the wall already there stays", on: (options) => options.walls === "transparent", set: (options, on) => ({ ...options, walls: on ? "transparent" : "replace" }) },
  { label: "Merge liquids", tooltip: "Copied liquid adds to the same kind, up to full; other liquid, and liquid where the copy has none, stays", on: (options) => options.liquids === "merge", set: (options, on) => ({ ...options, liquids: on ? "merge" : "replace" }) },
];

/**
 * One of several independent toggles (Brush's `Segments` picks one of many). `aria-disabled` keeps it focusable, so
 * its tooltip can say why it is off.
 */
function Toggle({ label, tooltip, pressed, disabled, onChange }: {
  readonly label: string; readonly tooltip: string; readonly pressed: boolean; readonly disabled: boolean; readonly onChange: (pressed: boolean) => void;
}): React.JSX.Element {
  return (
    <button
      type="button" aria-pressed={pressed} aria-disabled={disabled || undefined} data-tooltip={tooltip} data-tooltip-side="bottom"
      onClick={() => { if (!disabled) onChange(!pressed); }}
    >{label}</button>
  );
}

const anchorName = (anchor: PasteAnchor): string => anchor === "center" ? "Centre" : `${anchor.charAt(0).toUpperCase()}${anchor.slice(1).replace("-", " ")}`;

/**
 * The paste's reference point, as in an image editor's transform options: a 3 × 3 radio grid; the arrow keys move
 * the choice. The point chosen is the one under the pointer.
 */
function AnchorPicker({ value, disabled, onChange }: { readonly value: PasteAnchor; readonly disabled: boolean; readonly onChange: (anchor: PasteAnchor) => void }): React.JSX.Element {
  const current = PASTE_ANCHORS.indexOf(value);
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    const step = { ArrowLeft: current % 3 === 0 ? 0 : -1, ArrowRight: current % 3 === 2 ? 0 : 1, ArrowUp: current < 3 ? 0 : -3, ArrowDown: current > 5 ? 0 : 3 }[event.key];
    if (step === undefined) return;
    event.preventDefault();
    const next = PASTE_ANCHORS[current + step];
    if (next === undefined || disabled) return;
    onChange(next);
    event.currentTarget.querySelectorAll<HTMLButtonElement>("button")[current + step]?.focus();
  };
  return (
    <div className="anchor-picker" role="radiogroup" aria-label="Paste anchor" aria-disabled={disabled || undefined} onKeyDown={onKeyDown}>
      {PASTE_ANCHORS.map((anchor) => (
        <button
          key={anchor} type="button" role="radio" aria-checked={anchor === value} aria-label={anchorName(anchor)} tabIndex={anchor === value ? 0 : -1}
          data-tooltip={`Anchor: ${anchorName(anchor).toLowerCase()} of the paste under the pointer`} data-tooltip-side="bottom"
          onClick={() => { if (!disabled) onChange(anchor); }}
        />
      ))}
    </div>
  );
}

/** A command as a text button: the same label, shortcut and disabled reason as its menu item. */
function CommandButton({ command, primary = false }: { readonly command: Command; readonly primary?: boolean }): React.JSX.Element {
  const tooltip = [command.shortcut === undefined ? "" : shortcutText(command.shortcut), command.enabled ? "" : command.disabledReason ?? ""]
    .filter((part) => part !== "").join(" — ");
  return (
    <button
      type="button" className={`button button-small${primary && command.enabled ? " button-primary" : ""}`}
      aria-keyshortcuts={command.shortcut} aria-disabled={!command.enabled || undefined}
      {...(tooltip === "" ? {} : { "data-tooltip": tooltip, "data-tooltip-side": "bottom" })}
      onClick={() => { if (command.enabled) command.run(); }}
    >{command.label}</button>
  );
}

/**
 * Select's options, as an image editor's marquee: what Copy takes, then the clipboard actions. While a paste floats,
 * how it combines with what is there, then Place and Cancel. One row, the same controls as Brush.
 */
export function AreaOptions({ commands, disabled }: { readonly commands: readonly Command[]; readonly disabled: boolean }): React.JSX.Element {
  const state = useAreaStore();
  const copy = commandById(commands, "edit.copy");
  const lockedReason = disabled ? commandById(commands, "tool.select").disabledReason ?? "Finish the stroke first" : null;
  const tooLarge = state.selection !== null && !copy.enabled && copy.disabledReason?.startsWith("Too large") === true;
  const hint = state.message ?? (tooLarge ? copy.disabledReason : state.selection === null ? TOOLS.find((tool) => tool.id === "select")?.hint : "Ctrl+C to copy · Escape to deselect");
  return <>
    {state.pasting ? (
      <div className="brush-option-group" role="group" aria-label="Paste options">
        <span className="brush-option-label area-option-label">Paste</span>
        <AnchorPicker value={state.anchor} disabled={disabled} onChange={(anchor) => { useAreaStore.setState({ anchor }); }} />
        <div className="brush-segments area-toggles">
          {PASTE_TOGGLES.map((toggle) => (
            <Toggle
              key={toggle.label} label={toggle.label} tooltip={lockedReason ?? toggle.tooltip} pressed={toggle.on(state.options)} disabled={disabled}
              onChange={(on) => { useAreaStore.setState({ options: toggle.set(state.options, on) }); }}
            />
          ))}
        </div>
      </div>
    ) : (
      <div className="brush-option-group" role="group" aria-label="Copy layers">
        <span className="brush-option-label area-option-label">Layers</span>
        <div className="brush-segments area-toggles">
          {LAYERS.map(({ key, label, tooltip }) => {
            const needsBlocks = key === "objects" && !state.layers.blocks;
            return (
              <Toggle
                key={key} label={label} tooltip={lockedReason ?? (needsBlocks ? "Objects need Blocks" : `Copy ${tooltip.charAt(0).toLowerCase()}${tooltip.slice(1)}`)} pressed={state.layers[key] && !needsBlocks} disabled={disabled || needsBlocks}
                onChange={(on) => { useAreaStore.setState({ layers: { ...state.layers, [key]: on } }); }}
              />
            );
          })}
        </div>
      </div>
    )}
    <div className="brush-option-group" role="group" aria-label="Selection actions">
      {state.pasting
        ? <><CommandButton command={commandById(commands, "edit.placePaste")} primary /><CommandButton command={commandById(commands, "edit.cancelArea")} /></>
        : <><CommandButton command={copy} /><CommandButton command={commandById(commands, "edit.paste")} /><CommandButton command={commandById(commands, "edit.cancelArea")} /></>}
    </div>
    {/* The hint changes as the paste follows the pointer, so only results are announced. */}
    <span className={tooLarge ? "tool-options-notice" : "tool-options-hint"}>{hint}</span>
    <span className="visually-hidden" role="status">{state.notice}</span>
  </>;
}
