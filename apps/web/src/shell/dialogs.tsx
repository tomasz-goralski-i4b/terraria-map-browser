import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Icon } from "../ui/Icon.js";
import { shortcutText } from "../ui/IconButton.js";
import type { Command, CommandGroup } from "./commands.js";
import { useViewStore } from "./view-store.js";

/** A modal `<dialog>`: the browser traps focus, closes it on Escape and restores focus to where it was opened. */
export function useModal(open: boolean, onClose: () => void): React.RefObject<HTMLDialogElement | null> {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return undefined;
    // A click on the backdrop lands on the dialog element itself (its content never fills the backdrop).
    const onClick = (event: MouseEvent): void => {
      if (event.target === dialog) dialog.close();
    };
    dialog.addEventListener("close", onClose);
    dialog.addEventListener("click", onClick);
    return () => {
      dialog.removeEventListener("close", onClose);
      dialog.removeEventListener("click", onClick);
    };
  }, [onClose]);
  return ref;
}

const MAP_KEYS: readonly (readonly [string, string])[] = [
  ["Drag", "Pan the map"],
  ["Click, Enter", "Pin a tile (Inspect tool)"],
  ["Esc", "Unpin the tile"],
  ["Wheel, pinch", "Zoom at the pointer"],
  ["Arrow keys", "Pan (map focused)"],
  ["+ / −", "Zoom in / out (map focused)"],
  ["Tab", "Move focus between regions"],
];

/** The `?` overlay: every shortcut, grouped as in the menus, read from the command list. */
export function HelpOverlay({ commands }: { readonly commands: readonly Command[] }): React.JSX.Element {
  const open = useViewStore((state) => state.helpOpen);
  const setOpen = useViewStore((state) => state.setHelpOpen);
  const close = useMemo(() => () => {
    setOpen(false);
  }, [setOpen]);
  const ref = useModal(open, close);
  const titleId = useId();
  const groups: CommandGroup[] = ["File", "View", "Layers", "Tools", "Help"];

  return (
    <dialog ref={ref} className="dialog help-dialog" aria-labelledby={titleId}>
      <header className="dialog-header">
        <h2 id={titleId}>Keyboard shortcuts</h2>
        <button type="button" className="icon-button" aria-label="Close" onClick={close}><Icon name="close" /></button>
      </header>
      {open && (
        <div className="help-columns">
          {groups.map((group) => (
            <section key={group} aria-label={group}>
              <h3>{group}</h3>
              <dl className="shortcut-list">
                {commands.filter((command) => command.group === group && command.shortcut !== undefined).map((command) => (
                  <div key={command.id} className="shortcut-row" data-enabled={command.enabled}>
                    <dt>{command.label}</dt>
                    <dd><kbd>{shortcutText(command.shortcut ?? "")}</kbd></dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
          <section aria-label="Map">
            <h3>Map</h3>
            <dl className="shortcut-list">
              {MAP_KEYS.map(([keys, action]) => (
                <div key={keys} className="shortcut-row">
                  <dt>{action}</dt>
                  <dd><kbd>{keys}</kbd></dd>
                </div>
              ))}
            </dl>
          </section>
        </div>
      )}
    </dialog>
  );
}

/** Ctrl+K: find any command by name and run it (a combobox over a listbox of commands). */
export function CommandPalette({ commands }: { readonly commands: readonly Command[] }): React.JSX.Element {
  const open = useViewStore((state) => state.paletteOpen);
  const setOpen = useViewStore((state) => state.setPaletteOpen);
  const close = useMemo(() => () => {
    setOpen(false);
  }, [setOpen]);
  const ref = useModal(open, close);
  return (
    <dialog ref={ref} className="dialog palette-dialog" aria-label="Command palette">
      {/* Mounted per opening, so every opening starts with an empty query. */}
      {open && <PaletteBody commands={commands} close={close} />}
    </dialog>
  );
}

function PaletteBody({ commands, close }: { readonly commands: readonly Command[]; readonly close: () => void }): React.JSX.Element {
  const listId = useId();
  const list = useRef<HTMLUListElement>(null);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  // Keep the active option visible while the keyboard moves it (including wrap-around).
  useEffect(() => {
    list.current?.querySelector(`[id="${listId}-${String(active)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, listId]);
  const matches = commands.filter((command) => `${command.group} ${command.label}`.toLowerCase().includes(query.trim().toLowerCase()));
  const run = (command: Command | undefined): void => {
    if (!command?.enabled) return;
    close();
    command.run();
  };

  return (
    <>
      <div className="palette-header">
        <label className="search-field palette-search">
        <Icon name="search" />
        <input
          type="text"
          role="combobox"
          aria-label="Command"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={matches.length === 0 ? undefined : `${listId}-${String(active)}`}
          placeholder="Type a command"
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              const step = event.key === "ArrowDown" ? 1 : -1;
              setActive((active + step + matches.length) % Math.max(1, matches.length));
            } else if (event.key === "Enter") {
              event.preventDefault();
              run(matches[active]);
            }
          }}
        />
        </label>
        <button type="button" className="icon-button" aria-label="Close" onClick={close}><Icon name="close" /></button>
      </div>
      <ul ref={list} id={listId} role="listbox" aria-label="Commands" className="palette-list">
        {matches.map((command, index) => (
          <li
            key={command.id}
            id={`${listId}-${String(index)}`}
            role="option"
            aria-selected={index === active}
            aria-disabled={!command.enabled || undefined}
            className="palette-option"
            onPointerMove={() => {
              setActive(index);
            }}
            onClick={() => {
              run(command);
            }}
          >
            <span className="palette-group">{command.group}</span>
            <span className="palette-label">
              {command.label}
              {!command.enabled && command.disabledReason !== undefined && <span className="muted"> — {command.disabledReason}</span>}
            </span>
            {command.shortcut !== undefined && <kbd>{shortcutText(command.shortcut)}</kbd>}
          </li>
        ))}
        {matches.length === 0 && <li role="option" aria-selected="false" aria-disabled="true" className="palette-option muted">No matching command</li>}
      </ul>
    </>
  );
}
