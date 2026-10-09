import { useEffect, useId, useRef, useState } from "react";
import { Icon, type IconName } from "./Icon.js";
import { shortcutText } from "./IconButton.js";

export type MenuItem =
  | {
    readonly kind: "action";
    readonly label: string;
    readonly icon?: IconName;
    readonly shortcut?: string;
    /** Muted text on the right instead of a shortcut, e.g. a file's size and date. */
    readonly detail?: string;
    readonly disabled?: boolean;
    /** Shown on the right of a disabled item, so placeholders say why. */
    readonly disabledReason?: string;
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
  | {
    readonly kind: "submenu";
    readonly label: string;
    readonly icon?: IconName;
    readonly items: readonly MenuItem[];
    readonly disabled?: boolean;
    readonly disabledReason?: string;
  }
  /** A small caption above a group of items, e.g. the folder a list of worlds comes from. */
  | { readonly kind: "heading"; readonly label: string }
  | { readonly kind: "separator" };

type Focusable = Exclude<MenuItem, { kind: "separator" } | { kind: "heading" }>;

/** How long the pointer rests on a submenu item before it opens (as in desktop menus). */
const SUBMENU_DELAY_MS = 120;

interface MenuListProps {
  readonly id?: string;
  readonly items: readonly MenuItem[];
  readonly labelledBy?: string;
  readonly label?: string;
  readonly className?: string;
  readonly align?: "start" | "end";
  /** Where focus goes when the list opens; "list" focuses the list itself (opened by the pointer). */
  readonly initialFocus: "first" | "last" | "list";
  /** Closes the whole menu tree; `refocus` returns focus to the trigger. */
  readonly onClose: (refocus: boolean) => void;
  /** A submenu closes itself and returns focus to its item. */
  readonly onBack?: () => void;
  /** In a menu bar: ArrowLeft / ArrowRight move to the neighbouring menu. */
  readonly onHorizontal?: (step: 1 | -1) => void;
}

/**
 * One menu (WAI-ARIA menu pattern): the arrows, Home and End move between items; Enter, Space or ArrowRight open a
 * submenu, ArrowLeft or Escape close it; Escape closes the menu; the pointer moves focus with it, so hover and keyboard
 * show one highlight. Disabled items stay focusable (`aria-disabled`) so people can discover them.
 */
export function MenuList({ id, items, labelledBy, label, className, align = "start", initialFocus, onClose, onBack, onHorizontal }: MenuListProps): React.JSX.Element {
  const list = useRef<HTMLDivElement>(null);
  const refs = useRef(new Map<number, HTMLElement>());
  const [submenu, setSubmenu] = useState<{ readonly index: number; readonly focus: "first" | "list" } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  const focusable = items.flatMap((item, index) => (item.kind === "separator" || item.kind === "heading" ? [] : [index]));

  useEffect(() => {
    if (initialFocus === "list") list.current?.focus();
    else refs.current.get((initialFocus === "first" ? focusable[0] : focusable.at(-1)) ?? -1)?.focus();
    // Only on opening; later focus follows the keyboard and the pointer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => () => {
    window.clearTimeout(timer.current);
  }, []);

  const focusIndex = (index: number): void => {
    refs.current.get(index)?.focus();
  };
  const current = (): number => focusable.findIndex((index) => refs.current.get(index) === document.activeElement);
  const openSubmenu = (index: number, focus: "first" | "list"): void => {
    window.clearTimeout(timer.current);
    setSubmenu({ index, focus });
  };

  const activate = (item: Focusable, index: number): void => {
    if (item.disabled ?? false) return;
    if (item.kind === "action") {
      onClose(true);
      item.onSelect();
    } else if (item.kind === "check") item.onChange(!item.checked);
    else openSubmenu(index, "first");
  };

  const onKeyDown = (event: React.KeyboardEvent): void => {
    // Keys pressed inside a submenu bubble here through React's tree; only the list that holds the focus handles them.
    if ((event.target as Element).closest("[role=menu]") !== list.current) return;
    const position = current();
    const move = (next: number): void => {
      event.preventDefault();
      const count = focusable.length;
      focusIndex(focusable[(next + count) % count] ?? -1);
    };
    const index = focusable[position];
    const item = index === undefined ? undefined : (items[index] as Focusable | undefined);
    switch (event.key) {
      case "ArrowDown":
        move(position + 1);
        break;
      case "ArrowUp":
        move(position < 0 ? focusable.length - 1 : position - 1);
        break;
      case "Home":
        move(0);
        break;
      case "End":
        move(focusable.length - 1);
        break;
      case "ArrowRight":
        event.preventDefault();
        if (item?.kind === "submenu" && !(item.disabled ?? false) && index !== undefined) openSubmenu(index, "first");
        else onHorizontal?.(1);
        break;
      case "ArrowLeft":
        event.preventDefault();
        if (onBack !== undefined) onBack();
        else onHorizontal?.(-1);
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        if (onBack !== undefined) onBack();
        else onClose(true);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        if (item !== undefined && index !== undefined) activate(item, index);
        break;
      case "Tab":
        onClose(false);
        break;
      default:
        break;
    }
  };

  return (
    <div
      ref={list}
      id={id}
      role="menu"
      aria-labelledby={labelledBy}
      aria-label={label}
      tabIndex={-1}
      className={className === undefined ? "menu-popup" : `menu-popup ${className}`}
      data-align={align}
      onKeyDown={onKeyDown}
    >
      {groups(items).map((entry) => {
        if (entry.kind === "group") {
          return (
            <div key={`group-${String(entry.index)}`} role="group" aria-label={entry.label}>
              <div className="menu-heading" aria-hidden="true">{entry.label}</div>
              {entry.members.map((index) => renderItem(index))}
            </div>
          );
        }
        return renderItem(entry.index);
      })}
    </div>
  );

  function renderItem(index: number): React.ReactNode {
    const item = items[index];
    if (item === undefined || item.kind === "heading") return null;
    if (item.kind === "separator") return <div key={`separator-${String(index)}`} role="separator" className="menu-separator" />;
    const disabled = item.disabled ?? false;
    const isSubmenu = item.kind === "submenu";
    const open = submenu?.index === index;
    const reason = item.kind !== "check" && disabled ? item.disabledReason : undefined;
    let right: React.ReactNode = <span />;
    if (item.kind === "action" && item.detail !== undefined) right = <span className="menu-detail">{item.detail}</span>;
    else if (reason !== undefined) right = <span className="menu-detail">{reason}</span>;
    else if (item.kind !== "submenu" && item.shortcut !== undefined) right = <kbd className="menu-shortcut">{shortcutText(item.shortcut)}</kbd>;
    else if (isSubmenu) right = <Icon name="chevron" className="menu-submenu-arrow" />;
    let icon: React.ReactNode = null;
    if (item.kind === "check") icon = item.checked && <Icon name="check" />;
    else if (item.icon !== undefined) icon = <Icon name={item.icon} />;
    return (
      <div
        key={`${String(index)}-${item.label}`}
        className="menu-item-wrap"
        // Entering an open submenu cancels a close (or another opening) that crossing a sibling scheduled.
        onPointerEnter={open ? () => {
          window.clearTimeout(timer.current);
        } : undefined}
      >
        <div
          ref={(element) => {
            if (element === null) refs.current.delete(index);
            else refs.current.set(index, element);
          }}
          role={item.kind === "check" ? "menuitemcheckbox" : "menuitem"}
          aria-label={item.label}
          aria-description={reason ?? (item.kind === "action" ? item.detail : undefined)}
          aria-checked={item.kind === "check" ? item.checked : undefined}
          aria-disabled={disabled || undefined}
          aria-haspopup={isSubmenu ? "menu" : undefined}
          aria-expanded={isSubmenu ? open : undefined}
          aria-keyshortcuts={item.kind !== "submenu" ? item.shortcut : undefined}
          tabIndex={-1}
          className="menu-item"
          data-open={open || undefined}
          title={reason}
          // Movement, not entry: a menu opened from the keyboard under a resting pointer keeps its keyboard focus.
          onPointerMove={(event) => {
            if (event.currentTarget === document.activeElement) return;
            focusIndex(index);
            window.clearTimeout(timer.current);
            if (isSubmenu && !disabled) {
              timer.current = window.setTimeout(() => {
                setSubmenu({ index, focus: "list" });
              }, SUBMENU_DELAY_MS);
            } else if (submenu !== null) {
              timer.current = window.setTimeout(() => {
                setSubmenu(null);
              }, SUBMENU_DELAY_MS);
            }
          }}
          onClick={() => {
            activate(item, index);
          }}
        >
          <span className="menu-check" aria-hidden="true">{icon}</span>
          <span className="menu-label">{item.label}</span>
          {right}
        </div>
        {isSubmenu && open && (
          <MenuList
            items={item.items}
            label={item.label}
            className="menu-submenu"
            initialFocus={submenu.focus}
            onClose={onClose}
            onBack={() => {
              setSubmenu(null);
              focusIndex(index);
            }}
            {...(onHorizontal === undefined ? {} : { onHorizontal })}
          />
        )}
      </div>
    );
  }
}

type MenuEntry =
  | { readonly kind: "item"; readonly index: number }
  | { readonly kind: "group"; readonly index: number; readonly label: string; readonly members: readonly number[] };

/** A heading and the items under it (up to the next separator or heading) form one labelled group. */
function groups(items: readonly MenuItem[]): MenuEntry[] {
  const entries: MenuEntry[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (item?.kind !== "heading") {
      entries.push({ kind: "item", index });
      continue;
    }
    const members: number[] = [];
    while (index + 1 < items.length && items[index + 1]?.kind !== "separator" && items[index + 1]?.kind !== "heading") members.push(++index);
    entries.push({ kind: "group", index: index - members.length, label: item.label, members });
  }
  return entries;
}

/** Closes an open menu when the pointer goes down outside `root`. */
function useOutsidePointer(open: boolean, root: React.RefObject<HTMLElement | null>, close: () => void): void {
  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      if (!(root.current?.contains(event.target as Node) ?? false)) close();
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
    };
  }, [open, root, close]);
}

export interface MenuButtonProps {
  readonly label: string;
  /** Icon-only trigger when set; otherwise the label is the trigger's text. */
  readonly icon?: IconName;
  readonly items: readonly MenuItem[];
  readonly className?: string;
  readonly align?: "start" | "end";
}

/**
 * A menu button (WAI-ARIA menu button pattern): Enter, Space or ArrowDown opens it on the first item; Escape closes it
 * and returns focus to the button; Tab or a click outside close it.
 */
export function MenuButton({ label, icon, items, className, align = "start" }: MenuButtonProps): React.JSX.Element {
  const id = useId();
  const [open, setOpen] = useState<"first" | "last" | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const [close] = useState(() => (refocus: boolean): void => {
    setOpen(null);
    if (refocus) button.current?.focus();
  });
  const [closeOutside] = useState(() => (): void => {
    setOpen(null);
  });
  useOutsidePointer(open !== null, root, closeOutside);

  return (
    <div ref={root} className={className === undefined ? "menu" : `menu ${className}`}>
      <button
        ref={button}
        type="button"
        id={`${id}-button`}
        className={icon === undefined ? "menu-trigger" : "icon-button"}
        aria-haspopup="menu"
        aria-expanded={open !== null}
        aria-controls={open !== null ? `${id}-menu` : undefined}
        aria-label={icon === undefined ? undefined : label}
        data-tooltip={icon === undefined ? undefined : label}
        data-tooltip-side="bottom"
        onClick={() => {
          setOpen(open === null ? "first" : null);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(event.key === "ArrowDown" ? "first" : "last");
          }
        }}
      >
        {icon === undefined ? label : <Icon name={icon} />}
      </button>
      {open !== null && (
        <MenuList id={`${id}-menu`} labelledBy={`${id}-button`} items={items} align={align} initialFocus={open} onClose={close} />
      )}
    </div>
  );
}

export interface MenuBarMenu {
  readonly label: string;
  /** Alt + this letter opens the menu. */
  readonly mnemonic: string;
  readonly items: readonly MenuItem[];
}

type OpenMenu = { readonly index: number; readonly focus: "first" | "last" | "list" } | null;

/**
 * The application menu bar (WAI-ARIA menubar pattern): one Tab stop; ArrowLeft and ArrowRight move between menus and
 * keep a menu open while moving; ArrowDown, Enter or Space open one; Alt + its letter opens it from anywhere. While a
 * menu is open, pointing at another title opens that one, as in desktop editors.
 */
export function MenuBar({ label, menus }: { readonly label: string; readonly menus: readonly MenuBarMenu[] }): React.JSX.Element {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<number, HTMLButtonElement>());
  const [active, setActive] = useState(0);
  const [open, setOpen] = useState<OpenMenu>(null);
  const openRef = useRef<OpenMenu>(null);
  useEffect(() => {
    openRef.current = open;
  }, [open]);

  const [close] = useState(() => (refocus: boolean): void => {
    const previous = openRef.current;
    setOpen(null);
    if (refocus && previous !== null) buttons.current.get(previous.index)?.focus();
  });
  const [closeOutside] = useState(() => (): void => {
    setOpen(null);
  });
  useOutsidePointer(open !== null, root, closeOutside);

  const show = (index: number, focus: "first" | "last" | "list"): void => {
    setActive(index);
    setOpen({ index, focus });
  };
  const step = (from: number, delta: 1 | -1): number => (from + delta + menus.length) % menus.length;

  const mnemonics = menus.map((menu) => menu.mnemonic.toUpperCase()).join(",");
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat || event.defaultPrevented) return;
      // A modal dialog owns the keyboard; a menu opened behind it could not take focus.
      if (document.querySelector("dialog[open]") !== null) return;
      const index = mnemonics.split(",").findIndex((letter) => event.code === `Key${letter}`);
      if (index < 0) return;
      event.preventDefault();
      setActive(index);
      setOpen({ index, focus: "first" });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mnemonics]);

  return (
    <div ref={root} role="menubar" aria-label={label} className="menubar">
      {menus.map((menu, index) => {
        const isOpen = open?.index === index;
        return (
          <div key={menu.label} className="menu menubar-menu">
            <button
              ref={(element) => {
                if (element === null) buttons.current.delete(index);
                else buttons.current.set(index, element);
              }}
              type="button"
              role="menuitem"
              id={`${id}-${String(index)}`}
              className="menubar-item"
              tabIndex={index === active ? 0 : -1}
              aria-haspopup="menu"
              aria-expanded={isOpen}
              aria-keyshortcuts={`Alt+${menu.mnemonic.toUpperCase()}`}
              onClick={() => {
                if (isOpen) setOpen(null);
                else show(index, "list");
              }}
              onPointerMove={() => {
                if (open !== null && !isOpen) show(index, "list");
              }}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight" || event.key === "ArrowLeft") {
                  event.preventDefault();
                  const next = step(index, event.key === "ArrowRight" ? 1 : -1);
                  setActive(next);
                  buttons.current.get(next)?.focus();
                } else if (event.key === "ArrowDown" || event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  show(index, "first");
                } else if (event.key === "ArrowUp") {
                  event.preventDefault();
                  show(index, "last");
                }
              }}
            >
              {menu.label}
            </button>
            {isOpen && (
              <MenuList
                key={index}
                labelledBy={`${id}-${String(index)}`}
                items={menu.items}
                initialFocus={open.focus}
                onClose={close}
                onHorizontal={(delta) => {
                  show(step(index, delta), "first");
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
