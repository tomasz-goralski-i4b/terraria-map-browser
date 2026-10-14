import { useEffect, useId, useRef, useState } from "react";
import type { EntityItem, WorldChest } from "@studio/world-codec";
import { useLayoutStore } from "../shell/layout-store.js";
import { Icon } from "../ui/Icon.js";
import { IconButton } from "../ui/IconButton.js";
import { itemLabel, prefixLabel } from "../world/items.js";
import { slotLabel } from "./chest-fields.js";
import { ItemSprite } from "./ItemSprite.js";

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
  // The slot under the pointer or focus; each slot already carries its own label, so the line is not a live region.
  const [preview, setPreview] = useState<EntityItem | null | undefined>(undefined);

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
        {view === "grid" ? <SlotGrid slotCount={chest.slotCount} bySlot={bySlot} onPreview={setPreview} /> : <SlotList items={chest.items} onPreview={setPreview} />}
      </div>
      <footer className="chest-item-detail">
        {preview === undefined ? "Point at or focus a slot for its item and IDs."
          : preview === null ? "Empty slot"
          : `${slotLabel(preview)} · Item ID ${String(preview.itemId)}${preview.prefix === 0 ? "" : ` · Prefix ID ${String(preview.prefix)}`}`}
      </footer>
    </dialog>
  );
}

function SlotGrid({ slotCount, bySlot, onPreview }: {
  readonly slotCount: number;
  readonly bySlot: ReadonlyMap<number, EntityItem>;
  readonly onPreview: (item: EntityItem | null) => void;
}): React.JSX.Element {
  return (
    <ol className="chest-grid" onKeyDown={(event) => {
      const current = event.target;
      if (!(current instanceof HTMLElement)) return;
      const slot = Number(current.dataset["slot"]);
      const offsets: Readonly<Record<string, number>> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -SLOTS_PER_ROW, ArrowDown: SLOTS_PER_ROW };
      const offset = offsets[event.key];
      const next = event.key === "Home" ? 0 : event.key === "End" ? slotCount - 1 : offset === undefined ? undefined : Math.max(0, Math.min(slotCount - 1, slot + offset));
      if (next === undefined) return;
      event.preventDefault();
      event.currentTarget.querySelector<HTMLElement>(`[data-slot="${String(next)}"]`)?.focus();
    }}>
      {Array.from({ length: slotCount }, (_, slot) => {
        const item = bySlot.get(slot);
        const label = `Slot ${String(slot + 1)}: ${item === undefined ? "Empty" : slotLabel(item)}`;
        return (
          <li
            key={slot} role="listitem" className="chest-slot" data-slot={slot} data-empty={item === undefined}
            aria-label={label} title={label} tabIndex={0}
            onFocus={() => { onPreview(item ?? null); }} onMouseEnter={() => { onPreview(item ?? null); }}
          >
            {item !== undefined && (
              <>
                <ItemSprite itemId={item.itemId} />
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

function SlotList({ items, onPreview }: { readonly items: readonly EntityItem[]; readonly onPreview: (item: EntityItem | null) => void }): React.JSX.Element {
  if (items.length === 0) return <p className="panel-empty">This chest is empty.</p>;
  return (
    <table className="chest-list">
      <thead>
        <tr><th scope="col">Slot</th><th scope="col">Item</th><th scope="col">Stack</th><th scope="col">Prefix</th></tr>
      </thead>
      <tbody>
        {[...items].sort((a, b) => a.slot - b.slot).map((item) => (
          <tr key={item.slot} tabIndex={0} onFocus={() => { onPreview(item); }} onMouseEnter={() => { onPreview(item); }}>
            <td>{String(item.slot + 1)}</td>
            <td><span className="chest-list-item"><ItemSprite itemId={item.itemId} fallback={false} /><span>{itemLabel(item.itemId)}</span></span></td>
            <td>{String(item.stack)}</td>
            <td>{item.prefix === 0 ? "" : prefixLabel(item.prefix)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
