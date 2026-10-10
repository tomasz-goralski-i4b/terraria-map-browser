import { useRef } from "react";

export interface SplitterProps {
  readonly label: string;
  /** The size it controls, in CSS pixels. */
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
  /** The pane that grows when the pointer moves this way: left/right for a vertical splitter, up/down for a horizontal one. */
  readonly grows: "left" | "right" | "up" | "down";
  readonly controls?: string;
  readonly step?: number;
}

/**
 * A window splitter (WAI-ARIA `separator`, focusable), vertical (`grows` left or right) or horizontal (up or down):
 * drag it, or use the arrow keys along it (Shift for larger steps) and Home/End for the minimum and maximum.
 */
export function Splitter({ label, value, min, max, onChange, grows, controls, step = 16 }: SplitterProps): React.JSX.Element {
  const drag = useRef<{ readonly start: number; readonly startValue: number } | null>(null);
  const horizontal = grows === "up" || grows === "down";
  const sign = grows === "left" || grows === "up" ? -1 : 1;
  const clamp = (next: number): number => Math.min(max, Math.max(min, next));
  const along = (event: React.PointerEvent): number => (horizontal ? event.clientY : event.clientX);

  return (
    <div
      className={horizontal ? "splitter splitter-horizontal" : "splitter"}
      role="separator"
      aria-orientation={horizontal ? "horizontal" : "vertical"}
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-controls={controls}
      tabIndex={0}
      onPointerDown={(event) => {
        drag.current = { start: along(event), startValue: value };
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Synthetic or already released pointers cannot be captured; dragging still works over the handle.
        }
      }}
      onPointerMove={(event) => {
        if (drag.current === null) return;
        onChange(clamp(drag.current.startValue + sign * (along(event) - drag.current.start)));
      }}
      onPointerUp={() => {
        drag.current = null;
      }}
      onPointerCancel={() => {
        drag.current = null;
      }}
      onKeyDown={(event) => {
        const amount = event.shiftKey ? step * 4 : step;
        const next = {
          [horizontal ? "ArrowUp" : "ArrowLeft"]: value - sign * amount,
          [horizontal ? "ArrowDown" : "ArrowRight"]: value + sign * amount,
          Home: min,
          End: max,
        }[event.key];
        if (next === undefined) return;
        event.preventDefault();
        onChange(clamp(next));
      }}
    />
  );
}
