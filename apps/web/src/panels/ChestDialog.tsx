import { useEffect, useId, useRef } from "react";
import type { EntityItem, WorldChest } from "@studio/world-codec";
import { useLayoutStore } from "../shell/layout-store.js";
import { Icon } from "../ui/Icon.js";
import { IconButton } from "../ui/IconButton.js";
import { itemLabel, prefixLabel } from "../world/items.js";
import { slotLabel } from "./chest-fields.js";

/** The game lays a chest out in rows of ten slots. */
const SLOTS_PER_ROW = 10;

/**
 * A chest's slots over the map, as a modal `<dialog>`: the browser traps focus, Escape closes it and focus returns
 * to the Open button. The grid keeps every slot (empty ones too, as they matter for editing later); the list shows
 * the filled slots only. The chosen view is remembered with the layout.
 */
export function ChestDialog({ chest, title, onClose }: { readonly chest: WorldChest; readonly title: string; readonly onClose: () => void }): React.JSX.Element {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const view = useLayoutStore((state) => state.chestView);
  const setView = useLayoutStore((state) => state.setChestView);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return undefined;
    // Not closed in the cleanup: `close` fires as a later task and would reach the listener of a re-run effect
    // (StrictMode); unmounting removes the dialog, which ends the modal state anyway.
    if (!dialog.open) dialog.showModal();
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

  const bySlot = new Map(chest.items.map((item) => [item.slot, item]));
  return (
    <dialog ref={ref} className="dialog chest-dialog" aria-labelledby={titleId}>
      <header className="dialog-header">
        <h2 id={titleId}>{chest.name.length > 0 ? chest.name : title}</h2>
        <span className="chest-dialog-actions">
          <span className="chest-dialog-position">{`${String(chest.x)}, ${String(chest.y)} · ${String(chest.items.length)} of ${String(chest.slotCount)} filled`}</span>
          <IconButton icon="grid" label="Grid view" pressed={view === "grid"} onClick={() => {
            setView("grid");
          }} />
          <IconButton icon="list" label="List view" pressed={view === "list"} onClick={() => {
            setView("list");
          }} />
          <button type="button" className="icon-button" aria-label="Close" onClick={() => ref.current?.close()}><Icon name="close" /></button>
        </span>
      </header>
      {/* Both views share the grid's box, so switching never resizes the dialog; the list scrolls inside it. */}
      <div className="chest-body" style={{ "--rows": Math.max(1, Math.ceil(chest.slotCount / SLOTS_PER_ROW)) } as React.CSSProperties}>
        {view === "grid" ? <SlotGrid slotCount={chest.slotCount} bySlot={bySlot} /> : <SlotList items={chest.items} />}
      </div>
    </dialog>
  );
}

function SlotGrid({ slotCount, bySlot }: { readonly slotCount: number; readonly bySlot: ReadonlyMap<number, EntityItem> }): React.JSX.Element {
  return (
    <ol className="chest-grid">
      {Array.from({ length: slotCount }, (_, slot) => {
        const item = bySlot.get(slot);
        const label = `Slot ${String(slot + 1)}: ${item === undefined ? "Empty" : slotLabel(item)}`;
        return (
          <li key={slot} role="listitem" className="chest-slot" data-empty={item === undefined} aria-label={label} title={label} tabIndex={0}>
            {item !== undefined && (
              <>
                <span className="chest-slot-item">{String(item.itemId)}</span>
                {item.stack > 1 && <span className="chest-slot-stack">{String(item.stack)}</span>}
                {item.prefix !== 0 && <span className="chest-slot-prefix" aria-hidden="true">★</span>}
              </>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function SlotList({ items }: { readonly items: readonly EntityItem[] }): React.JSX.Element {
  if (items.length === 0) return <p className="panel-empty">This chest is empty.</p>;
  return (
    <table className="chest-list">
      <thead>
        <tr><th scope="col">Slot</th><th scope="col">Item</th><th scope="col">Stack</th><th scope="col">Prefix</th></tr>
      </thead>
      <tbody>
        {[...items].sort((a, b) => a.slot - b.slot).map((item) => (
          <tr key={item.slot}>
            <td>{String(item.slot + 1)}</td>
            <td>{itemLabel(item.itemId)}</td>
            <td>{String(item.stack)}</td>
            <td>{item.prefix === 0 ? "" : prefixLabel(item.prefix)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
