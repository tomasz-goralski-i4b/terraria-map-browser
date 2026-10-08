import { useRef } from "react";

export interface SplitterProps {
  readonly label: string;
  /** The size it controls, in CSS pixels. */
  readonly value: number;
  readonly min: number;
  readonly max: number;
  readonly onChange: (value: number) => void;
  /** The pane that grows when the pointer moves this way. */
  readonly grows: "left" | "right";
  readonly controls?: string;
  readonly step?: number;
}

/**
 * A vertical window splitter (WAI-ARIA `separator`, focusable): drag it, or use the arrow keys (Shift for larger
 * steps) and Home/End for the minimum and maximum.
 */
export function Splitter({ label, value, min, max, onChange, grows, controls, step = 16 }: SplitterProps): React.JSX.Element {
  const drag = useRef<{ readonly startX: number; readonly startValue: number } | null>(null);
  const sign = grows === "left" ? -1 : 1;
  const clamp = (next: number): number => Math.min(max, Math.max(min, next));

  return (
    <div
      className="splitter"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-controls={controls}
      tabIndex={0}
      onPointerDown={(event) => {
        drag.current = { startX: event.clientX, startValue: value };
        try {
          event.currentTarget.setPointerCapture(event.pointerId);
        } catch {
          // Synthetic or already released pointers cannot be captured; dragging still works over the handle.
        }
      }}
      onPointerMove={(event) => {
        if (drag.current === null) return;
        onChange(clamp(drag.current.startValue + sign * (event.clientX - drag.current.startX)));
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
          ArrowLeft: value - sign * amount,
          ArrowRight: value + sign * amount,
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
