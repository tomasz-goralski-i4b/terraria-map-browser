import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MenuList, type MenuItem } from "./Menu.js";

export interface ContextMenuState { readonly x: number; readonly y: number }

/** Keeps the menu this far from the window's edges. */
const MARGIN = 4;

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
  // Laid out at the point first, then measured and moved inside the window before it is painted.
  const [place, setPlace] = useState<ContextMenuState>(at);
  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect();
    if (rect === undefined) return;
    setPlace({
      x: Math.max(MARGIN, Math.min(at.x, window.innerWidth - rect.width - MARGIN)),
      y: Math.max(MARGIN, Math.min(at.y, window.innerHeight - rect.height - MARGIN)),
    });
  }, [at]);
  return (
    <div ref={ref} className="context-menu" style={{ left: place.x, top: place.y }}>
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
