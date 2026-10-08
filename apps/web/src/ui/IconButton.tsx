import { Icon, type IconName } from "./Icon.js";

export interface IconButtonProps {
  readonly icon: IconName;
  /** Accessible name; also the tooltip text. */
  readonly label: string;
  /** Shortcut shown in the tooltip and announced through `aria-keyshortcuts` (e.g. `H`, `Control+K`). */
  readonly shortcut?: string | undefined;
  /** Present for toggles (an active tool, a visible panel). */
  readonly pressed?: boolean | undefined;
  readonly disabled?: boolean | undefined;
  /** Why a disabled control is disabled; appended to the tooltip. */
  readonly disabledReason?: string | undefined;
  readonly tooltipSide?: "right" | "bottom" | "top" | "left";
  readonly className?: string;
  /** For roving focus in toolbars. */
  readonly tabIndex?: number;
  /** Identifies a tool button for roving focus (`data-tool`). */
  readonly dataTool?: string;
  readonly onClick?: () => void;
}

/** Shortcut text as shown to people: `Control+K` → `Ctrl+K`. */
export function shortcutText(shortcut: string): string {
  return shortcut.replace("Control", "Ctrl");
}

/**
 * An icon-only button. The tooltip is drawn by CSS from `data-tooltip` on hover and on keyboard focus, so it costs
 * no layout and needs no portal; the name and shortcut reach assistive technology through ARIA instead.
 */
export function IconButton(props: IconButtonProps): React.JSX.Element {
  const { icon, label, shortcut, pressed, disabled = false, disabledReason, tooltipSide = "bottom", className, tabIndex, dataTool, onClick } = props;
  const tooltip = [label, shortcut === undefined ? "" : `(${shortcutText(shortcut)})`, disabled && disabledReason !== undefined ? `— ${disabledReason}` : ""]
    .filter((part) => part !== "").join(" ");
  return (
    <button
      type="button"
      className={className === undefined ? "icon-button" : `icon-button ${className}`}
      aria-label={label}
      aria-pressed={pressed}
      aria-keyshortcuts={shortcut}
      aria-disabled={disabled || undefined}
      tabIndex={tabIndex}
      data-tool={dataTool}
      data-tooltip={tooltip}
      data-tooltip-side={tooltipSide}
      onClick={() => {
        // aria-disabled (not `disabled`) keeps the control focusable, so its tooltip still explains it.
        if (!disabled) onClick?.();
      }}
    >
      <Icon name={icon} />
    </button>
  );
}
