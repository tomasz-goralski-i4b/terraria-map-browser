import { useEffect, useId, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon.js";
import { shortcutText } from "./IconButton.js";

export type MenuItem =
  | {
    readonly kind: "action";
    readonly label: string;
    readonly shortcut?: string;
    readonly disabled?: boolean;
    readonly onSelect: () => void;
  }
  | {
    readonly kind: "check";
    readonly label: string;
    readonly checked: boolean;
    readonly shortcut?: string;
    readonly disabled?: boolean;
    readonly onChange: (checked: boolean) => void;
  }
  | { readonly kind: "separator" };

export interface MenuButtonProps {
  readonly label: string;
  /** Icon-only trigger when set; otherwise the label is the trigger's text. */
  readonly icon?: IconName;
  readonly items: readonly MenuItem[];
  readonly className?: string;
  readonly align?: "start" | "end";
}

/**
 * A menu button (WAI-ARIA menu button pattern): Enter, Space or ArrowDown opens it on the first item; the arrows,
 * Home and End move between items; Escape closes it and returns focus to the button; Tab or a click outside close it.
 * Disabled items stay focusable (`aria-disabled`) so people can discover them.
 */
export function MenuButton({ label, icon, items, className, align = "start" }: MenuButtonProps): React.JSX.Element {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [focusFirst, setFocusFirst] = useState<"first" | "last">("first");
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);

  const itemElements = (): HTMLElement[] => [...(menu.current?.querySelectorAll<HTMLElement>("[role^=menuitem]") ?? [])];

  useEffect(() => {
    if (!open) return undefined;
    const elements = itemElements();
    (focusFirst === "first" ? elements[0] : elements.at(-1))?.focus();
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (!(menu.current?.contains(target) ?? false) && !(button.current?.contains(target) ?? false)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, focusFirst]);

  const close = (refocus: boolean): void => {
    setOpen(false);
    if (refocus) button.current?.focus();
  };

  const onMenuKeyDown = (event: React.KeyboardEvent): void => {
    const elements = itemElements();
    const index = elements.indexOf(document.activeElement as HTMLElement);
    const move = (next: number): void => {
      event.preventDefault();
      elements[(next + elements.length) % elements.length]?.focus();
    };
    if (event.key === "ArrowDown") move(index + 1);
    else if (event.key === "ArrowUp") move(index - 1);
    else if (event.key === "Home") move(0);
    else if (event.key === "End") move(elements.length - 1);
    else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") close(false);
  };

  return (
    <div className={className === undefined ? "menu" : `menu ${className}`}>
      <button
        ref={button}
        type="button"
        id={`${id}-button`}
        className={icon === undefined ? "menu-trigger" : "icon-button"}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? `${id}-menu` : undefined}
        aria-label={icon === undefined ? undefined : label}
        data-tooltip={icon === undefined ? undefined : label}
        data-tooltip-side="bottom"
        onClick={() => {
          setFocusFirst("first");
          setOpen(!open);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setFocusFirst(event.key === "ArrowDown" ? "first" : "last");
            setOpen(true);
          }
        }}
      >
        {icon === undefined ? label : <Icon name={icon} />}
      </button>
      {open && (
        <div ref={menu} id={`${id}-menu`} role="menu" aria-labelledby={`${id}-button`} className="menu-popup" data-align={align} onKeyDown={onMenuKeyDown}>
          {items.map((item, index) => {
            if (item.kind === "separator") return <div key={`separator-${String(index)}`} role="separator" className="menu-separator" />;
            const disabled = item.disabled ?? false;
            const activate = (): void => {
              if (disabled) return;
              if (item.kind === "action") {
                close(true);
                item.onSelect();
              } else item.onChange(!item.checked);
            };
            return (
              <div
                key={item.label}
                role={item.kind === "check" ? "menuitemcheckbox" : "menuitem"}
                aria-checked={item.kind === "check" ? item.checked : undefined}
                aria-disabled={disabled || undefined}
                aria-keyshortcuts={item.shortcut}
                tabIndex={-1}
                className="menu-item"
                onClick={activate}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    activate();
                  }
                }}
              >
                <span className="menu-check" aria-hidden="true">{item.kind === "check" && item.checked && <Icon name="check" />}</span>
                <span className="menu-label">{item.label}</span>
                {item.shortcut !== undefined && <kbd className="menu-shortcut">{shortcutText(item.shortcut)}</kbd>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
