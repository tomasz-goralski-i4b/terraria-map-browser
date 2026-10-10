import { useEffect, useMemo, useRef, useState } from "react";
import { create } from "zustand";
import type { BrushContentLayer } from "@studio/world-model";
import { confirmAction } from "../shell/ConfirmDialog.js";
import { useLayoutStore } from "../shell/layout-store.js";
import { notify } from "../shell/notification-store.js";
import { Icon } from "../ui/Icon.js";
import { IconButton } from "../ui/IconButton.js";
import { MenuButton, MenuList, type MenuItem } from "../ui/Menu.js";
import { findMaterial, type BrushMaterials } from "../world/brush-materials.js";
import {
  addSwatches, createPalette, deletePalette, exportPalettes, importPalettes, removeSwatch, renamePalette,
  sameSwatch, usePaletteStore, type PaletteSwatch,
} from "../world/brush-palettes.js";
import { brushLayers, chooseBrushMaterial, chooseBrushPaint, loadedBrushMaterials, useBrushStore } from "../world/brush-session.js";
import { MaterialSwatch, paintColor, swatchName } from "./material-swatch.js";

export type SwatchCategory = "block" | "wall" | "paint";
/** Where the swatches come from: "all" materials, the "recent"ly used ones, or a custom palette (its id). */
export type SwatchSource = string;

interface SwatchesView {
  readonly category: SwatchCategory;
  readonly source: SwatchSource;
  readonly query: string;
  readonly mode: "grid" | "list";
  /** Bumped to move focus to the search field (the tool options' material chips do it). */
  readonly focusRequest: number;
}
let handledFocusRequest = 0;
export const useSwatchesView = create<SwatchesView>()(() => ({ category: "block", source: "all", query: "", mode: "grid", focusRequest: 0 }));

/** Shows the Swatches tab of the dock on a category, as clicking a material in the tool options does. */
export function showSwatches(category: SwatchCategory): void {
  const layout = useLayoutStore.getState();
  layout.setDockHidden(false);
  layout.setDockTab("swatches");
  layout.setSectionOpen("swatches", true);
  useSwatchesView.setState((state) => ({ category, focusRequest: state.focusRequest + 1 }));
}

const CATEGORIES: readonly { readonly id: SwatchCategory; readonly label: string }[] = [
  { id: "block", label: "Blocks" }, { id: "wall", label: "Walls" }, { id: "paint", label: "Paints" },
];

interface ShownSwatch {
  readonly key: string;
  readonly swatch: PaletteSwatch | null;
  readonly paint: number | null;
  readonly name: string;
  readonly color: number | null;
  readonly paintColor: number | null;
}

function shownSwatches(materials: BrushMaterials, view: SwatchesView, recent: readonly PaletteSwatch[], palette: readonly PaletteSwatch[] | null): ShownSwatch[] {
  const query = view.query.trim().toLowerCase();
  const matches = (name: string, id: number): boolean => query.length === 0 || name.toLowerCase().includes(query) || String(id) === query;
  if (view.category === "paint") {
    return [{ id: 0, name: "No paint", color: null }, ...materials.paints].filter(({ name, id }) => matches(name, id))
      .map(({ id, name, color }) => ({ key: `paint:${String(id)}`, swatch: null, paint: id, name, color, paintColor: null }));
  }
  const layer: BrushContentLayer = view.category;
  const swatches = view.source === "all"
    ? (layer === "block" ? materials.blocks : materials.walls).map(({ id }) => ({ layer, id, paint: 0 }))
    : (view.source === "recent" ? recent : palette ?? []).filter((swatch) => swatch.layer === layer);
  return swatches.flatMap((swatch) => {
    const material = findMaterial(materials, swatch.layer, swatch.id);
    if (material === undefined || !matches(material.name, material.id)) return [];
    return [{
      key: `${swatch.layer}:${String(swatch.id)}:${String(swatch.paint)}`, swatch, paint: null,
      name: swatchName(materials, swatch.layer, swatch.id, swatch.paint), color: material.color, paintColor: paintColor(materials, swatch.paint),
    }];
  });
}

/** Moves focus between the swatch buttons with the arrow keys, Home and End (one Tab stop for the whole grid). */
function onGridKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
  const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("button[data-swatch]")];
  const index = buttons.findIndex((button) => button === document.activeElement);
  if (index < 0 || buttons.length === 0) return;
  const first = buttons[0];
  const columns = first === undefined ? 1 : Math.max(1, Math.round(event.currentTarget.clientWidth / first.offsetWidth));
  const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: columns, ArrowUp: -columns }[event.key];
  let next: number | undefined;
  if (step !== undefined) next = Math.min(buttons.length - 1, Math.max(0, index + step));
  else if (event.key === "Home") next = 0;
  else if (event.key === "End") next = buttons.length - 1;
  if (next === undefined) return;
  event.preventDefault();
  buttons[next]?.focus();
}

function download(name: string, text: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * The Swatches panel (as in image editors): every block, wall and paint the loaded world can take, the recently used
 * ones and the user's own palettes, searchable, as a grid of map colours or a list of names. Clicking a swatch makes it
 * the brush material; custom palettes collect swatches (a material with its paint) and travel as JSON files.
 */
export function SwatchesPanel(): React.JSX.Element {
  const brushWorld = useBrushStore((state) => state.world);
  // The brush's world version keys the loaded world's materials (read outside React).
  const materials = useMemo(() => loadedBrushMaterials(), [brushWorld]); // eslint-disable-line react-hooks/exhaustive-deps -- see above
  const view = useSwatchesView();
  const palettes = usePaletteStore((state) => state.palettes);
  const recent = usePaletteStore((state) => state.recent);
  const brush = useBrushStore();
  const searchRef = useRef<HTMLInputElement>(null);
  const importRef = useRef<HTMLInputElement>(null);
  // A material chip asks for the search field, also when its click is what mounts this panel.
  useEffect(() => {
    if (view.focusRequest === handledFocusRequest) return;
    handledFocusRequest = view.focusRequest;
    searchRef.current?.focus();
  }, [view.focusRequest]);
  // The draft name while a custom palette is being named in place.
  const [renaming, setRenaming] = useState<string | null>(null);
  const renameCancelled = useRef(false);
  // The swatch whose context menu is open, and where (viewport pixels).
  const [contextMenu, setContextMenu] = useState<{ readonly x: number; readonly y: number; readonly swatch: PaletteSwatch } | null>(null);
  const contextRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (contextMenu === null) return undefined;
    const onPointerDown = (event: PointerEvent): void => {
      if (!(contextRef.current?.contains(event.target as Node) ?? false)) setContextMenu(null);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => { document.removeEventListener("pointerdown", onPointerDown); };
  }, [contextMenu]);

  const palette = palettes.find((candidate) => candidate.id === view.source) ?? null;
  const source = view.source === "all" || view.source === "recent" || palette !== null ? view.source : "all";
  const shown = useMemo(
    () => (materials === null ? [] : shownSwatches(materials, { ...view, source }, recent, palette?.swatches ?? null)),
    [materials, view, source, recent, palette],
  );

  if (materials === null) {
    return <p className="muted swatches-empty">{brush.reason ?? "Open a vanilla world to choose materials."}</p>;
  }

  const layers = brushLayers(brush.layer);
  const isSelected = (item: ShownSwatch): boolean => {
    if (item.paint !== null) return layers.every((layer) => (layer === "block" ? brush.blockPaint : brush.wallPaint) === item.paint);
    const swatch = item.swatch;
    if (swatch === null) return false;
    const [id, paint] = swatch.layer === "block" ? [brush.blockId, brush.blockPaint] : [brush.wallId, brush.wallPaint];
    return swatch.id === id && (source === "all" || swatch.paint === paint);
  };
  const choose = (item: ShownSwatch): void => {
    if (item.paint !== null) chooseBrushPaint(item.paint);
    else if (item.swatch !== null) chooseBrushMaterial(item.swatch.layer, item.swatch.id, source === "all" ? undefined : item.swatch.paint);
  };
  const current = (): PaletteSwatch[] => brushLayers(brush.layer).map((layer) => (layer === "block"
    ? { layer, id: brush.blockId, paint: brush.blockPaint }
    : { layer, id: brush.wallId, paint: brush.wallPaint }));
  /** "Add to <palette>" for every custom palette, and a new palette holding the swatches. */
  const addMenu = (swatches: readonly PaletteSwatch[]): MenuItem[] => [
    ...palettes.map((candidate): MenuItem => {
      const has = swatches.every((swatch) => candidate.swatches.some((other) => sameSwatch(other, swatch)));
      return {
        kind: "action", label: `Add to “${candidate.name}”`, disabled: has, disabledReason: "Already in it",
        onSelect: () => { addSwatches(candidate.id, swatches); },
      };
    }),
    ...(palettes.length === 0 ? [] : [{ kind: "separator" } as const]),
    { kind: "action", label: swatches.length === 1 ? "New palette with this swatch" : "New palette with these swatches", icon: "copy", onSelect: () => { newPalette(swatches); } },
  ];
  const newPalette = (swatches: readonly PaletteSwatch[] = current()): void => {
    const name = `Palette ${String(palettes.length + 1)}`;
    const id = createPalette(name, swatches);
    useSwatchesView.setState({ source: id, category: view.category === "paint" ? brushLayers(brush.layer)[0] ?? "block" : view.category });
    setRenaming(name);
  };
  const menu: MenuItem[] = [
    { kind: "action", label: "New palette from current materials", icon: "copy", onSelect: () => { newPalette(); } },
    {
      kind: "action", label: "Add current materials", disabled: palette === null, disabledReason: "Choose a custom palette",
      onSelect: () => { if (palette !== null) addSwatches(palette.id, current()); },
    },
    {
      kind: "action", label: "Rename palette…", disabled: palette === null, disabledReason: "Choose a custom palette",
      onSelect: () => { if (palette !== null) setRenaming(palette.name); },
    },
    {
      kind: "action", label: "Delete palette", disabled: palette === null, disabledReason: "Choose a custom palette",
      onSelect: () => {
        if (palette === null) return;
        void confirmAction({
          title: "Delete palette", message: `Delete the palette “${palette.name}” and its ${String(palette.swatches.length)} swatches?`,
          confirmLabel: "Delete", danger: true,
        }).then((choice) => {
          if (choice !== "confirm") return;
          deletePalette(palette.id);
          useSwatchesView.setState({ source: "all" });
        });
      },
    },
    {
      kind: "action", label: "Export palettes…", icon: "download", disabled: palettes.length === 0, disabledReason: "No custom palettes",
      onSelect: () => { download(palette === null ? "palettes.json" : `${palette.name}.palette.json`, exportPalettes(palette === null ? undefined : [palette.id])); },
    },
    { kind: "action", label: "Import palettes…", icon: "folder", onSelect: () => { importRef.current?.click(); } },
  ];

  return (
    <div className="swatches-panel">
      <div className="swatches-toolbar">
        <div className="brush-segments swatches-categories" role="group" aria-label="Swatch kind">
          {CATEGORIES.map(({ id, label }) => (
            <button key={id} type="button" aria-pressed={view.category === id} onClick={() => { useSwatchesView.setState({ category: id }); }}>{label}</button>
          ))}
        </div>
        <MenuButton label="Add current materials to a palette" icon="plus" items={addMenu(current())} align="end" />
        <IconButton
          icon={view.mode === "grid" ? "list" : "grid"} label={view.mode === "grid" ? "Show as list" : "Show as grid"}
          onClick={() => { useSwatchesView.setState({ mode: view.mode === "grid" ? "list" : "grid" }); }}
        />
        <MenuButton label="Palette actions" icon="more" items={menu} align="end" />
      </div>
      <div className="swatches-toolbar">
        <label className="search-field">
          <Icon name="search" />
          <input
            ref={searchRef} type="search" aria-label="Filter swatches" placeholder="Filter by name or id" value={view.query}
            onChange={(event) => { useSwatchesView.setState({ query: event.target.value }); }}
          />
        </label>
        {view.category !== "paint" && renaming !== null && palette !== null && (
          <input
            className="swatches-rename" aria-label="Palette name" value={renaming} autoFocus maxLength={80}
            onChange={(event) => { setRenaming(event.target.value); }}
            onFocus={(event) => { event.target.select(); }}
            onBlur={() => {
              if (!renameCancelled.current) renamePalette(palette.id, renaming);
              renameCancelled.current = false;
              setRenaming(null);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.stopPropagation();
                renameCancelled.current = true;
              }
              if (event.key === "Enter" || event.key === "Escape") event.currentTarget.blur();
            }}
          />
        )}
        {view.category !== "paint" && (renaming === null || palette === null) && (
          <select className="select swatches-source" aria-label="Swatch source" value={source} onChange={(event) => { useSwatchesView.setState({ source: event.target.value }); }}>
            <option value="all">All materials</option>
            <option value="recent">Recently used</option>
            {palettes.length > 0 && <optgroup label="My palettes">{palettes.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}</optgroup>}
          </select>
        )}
      </div>
      <div className="swatches-grid" data-mode={view.mode} role="group" aria-label="Swatches" onKeyDown={onGridKeyDown}>
        {shown.map((item, index) => (
          <button
            key={item.key} type="button" data-swatch="" className="swatch-button" aria-pressed={isSelected(item)} aria-label={item.name}
            title={item.swatch === null ? item.name : `${item.name} — right-click to add it to a palette`}
            tabIndex={index === 0 ? 0 : -1}
            onClick={() => { choose(item); }}
            onContextMenu={(event) => {
              const swatch = item.swatch;
              if (swatch === null) return;
              event.preventDefault();
              setContextMenu({ x: Math.min(event.clientX, window.innerWidth - 240), y: event.clientY, swatch });
            }}
            onKeyDown={(event) => {
              if ((event.key === "Delete" || event.key === "Backspace") && palette !== null && item.swatch !== null) removeSwatch(palette.id, item.swatch);
            }}
          >
            {item.paint !== null ? <MaterialSwatch color={item.color} /> : <MaterialSwatch color={item.color} paint={item.paintColor} />}
            {view.mode === "list" && <span className="swatch-name">{item.name}</span>}
          </button>
        ))}
        {palette !== null && view.category !== "paint" && (
          <button type="button" className="swatch-button swatch-add" aria-label={`Add current materials to “${palette.name}”`} title={`Add current materials to “${palette.name}”`}
            onClick={() => { addSwatches(palette.id, current()); }}>
            <span className="material-swatch" aria-hidden="true">+</span>
            {view.mode === "list" && <span className="swatch-name">Add current</span>}
          </button>
        )}
      </div>
      {shown.length === 0 && <p className="muted swatches-empty">{source === "recent" ? "Swatches you paint with appear here." : view.query.length > 0 ? "No swatch matches." : "This palette is empty: add the current materials with +."}</p>}
      {contextMenu !== null && (
        <div ref={contextRef} className="swatch-context" style={{ left: contextMenu.x, top: contextMenu.y }}>
          <MenuList
            label="Swatch actions" initialFocus="first" onClose={() => { setContextMenu(null); }}
            items={[
              ...addMenu([contextMenu.swatch]),
              ...(palette === null ? [] : [
                { kind: "separator" } as const,
                { kind: "action", label: `Remove from “${palette.name}”`, onSelect: () => { removeSwatch(palette.id, contextMenu.swatch); } } as const,
              ]),
            ]}
          />
        </div>
      )}
      <input
        ref={importRef} type="file" accept=".json,application/json" hidden aria-hidden="true"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file === undefined) return;
          void file.text().then((text) => {
            const count = importPalettes(text);
            notify({ kind: "success", title: `Imported ${String(count)} ${count === 1 ? "palette" : "palettes"}`, detail: file.name });
          }).catch((error: unknown) => {
            notify({ kind: "error", title: "Palettes not imported", detail: error instanceof Error ? error.message : String(error) });
          });
        }}
      />
    </div>
  );
}
