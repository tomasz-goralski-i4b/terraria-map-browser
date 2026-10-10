/**
 * One of several independent toggles (Brush's `Segments` picks one of many). `aria-disabled` keeps it focusable, so
 * its tooltip can say why it is off.
 */
export function Toggle({ label, tooltip, pressed, disabled, onChange }: {
  readonly label: string; readonly tooltip: string; readonly pressed: boolean; readonly disabled: boolean; readonly onChange: (pressed: boolean) => void;
}): React.JSX.Element {
  return (
    <button
      type="button" aria-pressed={pressed} aria-disabled={disabled || undefined} data-tooltip={tooltip} data-tooltip-side="bottom"
      onClick={() => { if (!disabled) onChange(!pressed); }}
    >{label}</button>
  );
}
