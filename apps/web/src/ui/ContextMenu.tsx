import { useEffect, useRef } from "react";
import { MenuList, type MenuItem } from "./Menu.js";

export interface ContextMenuState { readonly x: number; readonly y: number }

/** Rough size used to keep the popup inside the window; the menu itself is laid out by CSS. */
const MENU_WIDTH = 240;
const ITEM_HEIGHT = 30;

/**
 * A menu at a viewport point (right-click, or the Menu key on a focused item). It closes on a pointer down outside,
 * on scroll or resize (it would drift from what it belongs to) and on Escape; focus then returns to where it was.
 */
export function ContextMenu({ at, label, items, onClose }: {
  readonly at: ContextMenuState;
  readonly label: string;
  readonly items: readonly MenuItem[];
  readonly onClose: () => void;
}): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const opener = useRef<Element | null>(null);
  opener.current ??= document.activeElement;
  useEffect(() => {
    const onPointerDown = (event: PointerEvent): void => {
      if (!(ref.current?.contains(event.target as Node) ?? false)) onClose();
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("resize", onClose);
    document.addEventListener("scroll", onClose, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("resize", onClose);
      document.removeEventListener("scroll", onClose, true);
    };
  }, [onClose]);
  const left = Math.max(0, Math.min(at.x, window.innerWidth - MENU_WIDTH));
  const top = Math.max(0, Math.min(at.y, window.innerHeight - 16 - ITEM_HEIGHT * items.length));
  return (
    <div ref={ref} className="context-menu" style={{ left, top }}>
      <MenuList
        label={label}
        initialFocus="first"
        items={items}
        onClose={(refocus) => {
          onClose();
          if (refocus && opener.current instanceof HTMLElement) opener.current.focus();
        }}
      />
    </div>
  );
}
