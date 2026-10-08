import { Icon } from "./Icon.js";

export interface ToggleProps {
  readonly label: string;
  readonly checked: boolean;
  readonly onChange: (checked: boolean) => void;
  readonly disabled?: boolean;
  readonly shortcut?: string;
}

/** A switch (`role="switch"`). */
export function Toggle({ label, checked, onChange, disabled = false, shortcut }: ToggleProps): React.JSX.Element {
  return (
    <button
      type="button"
      role="switch"
      className="toggle"
      aria-checked={checked}
      aria-keyshortcuts={shortcut}
      disabled={disabled}
      onClick={() => {
        onChange(!checked);
      }}
    >
      <span className="toggle-track" aria-hidden="true"><span className="toggle-thumb" /></span>
      <span>{label}</span>
    </button>
  );
}

export interface VisibilityRowProps {
  readonly label: string;
  readonly visible: boolean;
  readonly onChange: (visible: boolean) => void;
  readonly disabled?: boolean;
  readonly shortcut?: string;
  /** Trailing content, e.g. a swatch or a count. */
  readonly children?: React.ReactNode;
}

/** The eye-icon row of layer lists: the eye is a toggle button named after the layer, the label stays readable. */
export function VisibilityRow({ label, visible, onChange, disabled = false, shortcut, children }: VisibilityRowProps): React.JSX.Element {
  return (
    <div className="visibility-row" data-visible={visible} aria-disabled={disabled || undefined}>
      <button
        type="button"
        className="icon-button"
        aria-label={`Show ${label}`}
        aria-pressed={visible}
        aria-keyshortcuts={shortcut}
        disabled={disabled}
        onClick={() => {
          onChange(!visible);
        }}
      >
        <Icon name={visible ? "eye" : "eyeOff"} />
      </button>
      <span className="visibility-label">{label}</span>
      {children}
    </div>
  );
}
