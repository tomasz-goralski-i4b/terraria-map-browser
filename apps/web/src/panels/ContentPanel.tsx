import { useEffect, useMemo, useState } from "react";
import { contentColor, liquidColors, terrariaMapPalette, type Rgba } from "@studio/renderer";
import type { ContentRef } from "@studio/world-model";
import { useAppStore } from "../store.js";
import { Table, type Column } from "../ui/Table.js";
import { countContentInSlices, type ContentCounts, type CountablePlanes } from "../world/content-counts.js";
import { contentKey, contentName, LIQUID_NAMES } from "../world/content-names.js";
import { getDefaultWorldSession } from "../world/world-session.js";

/** What the Content panel reads of a world: three planes and the palette, by reference. */
export interface ContentWorld {
  readonly planes: CountablePlanes;
  readonly palette: readonly ContentRef[];
}

export type ContentKind = "block" | "wall" | "liquid";

export interface ContentRow {
  readonly key: string;
  readonly kind: ContentKind;
  readonly name: string;
  readonly id: string;
  readonly count: number;
  readonly share: number;
  readonly color: Rgba;
}

/** Counts are computed once per loaded world and kept while it is loaded, so reopening the panel is instant. */
const countCache = new WeakMap<CountablePlanes, ContentCounts>();

export function contentRows(world: ContentWorld, counts: ContentCounts): ContentRow[] {
  const total = world.planes.block.length || 1;
  const rows: ContentRow[] = [];
  const add = (kind: ContentKind, key: string, name: string, id: string, count: number, color: Rgba): void => {
    if (count > 0) rows.push({ key, kind, name, id, count, share: count / total, color });
  };
  world.palette.forEach((ref, index) => {
    add("block", `block:${String(index)}`, contentName(ref, "block"), contentKey(ref), counts.blocks[index] ?? 0, contentColor(ref, "block", terrariaMapPalette));
    add("wall", `wall:${String(index)}`, contentName(ref, "wall"), contentKey(ref), counts.walls[index] ?? 0, contentColor(ref, "wall", terrariaMapPalette));
  });
  const liquids = liquidColors(terrariaMapPalette);
  LIQUID_NAMES.forEach((name, kind) => {
    if (kind === 0) return;
    add("liquid", `liquid:${String(kind)}`, name, `liquid:${String(kind)}`, counts.liquids[kind] ?? 0, liquids[kind] ?? [0, 0, 0, 0]);
  });
  return rows;
}

function swatch(color: Rgba): React.CSSProperties {
  const [r, g, b] = color;
  return { backgroundColor: `rgb(${String(r)} ${String(g)} ${String(b)})` };
}

const KIND_LABELS: Readonly<Record<ContentKind, string>> = { block: "Block", wall: "Wall", liquid: "Liquid" };

const COLUMNS: readonly Column<ContentRow>[] = [
  {
    id: "name", title: "Content", width: 96, hideable: false, sortValue: (row) => row.name,
    render: (row) => (
      <span className="content-name">
        <span className="swatch" style={swatch(row.color)} aria-hidden="true" />
        {row.name}
      </span>
    ),
  },
  { id: "kind", title: "Kind", width: 48, sortValue: (row) => row.kind, render: (row) => KIND_LABELS[row.kind] },
  { id: "id", title: "ID", width: 96, defaultHidden: true, sortValue: (row) => row.id, render: (row) => row.id },
  { id: "count", title: "Tiles", width: 72, align: "end", sortValue: (row) => row.count, render: (row) => row.count.toLocaleString("en-US") },
  { id: "share", title: "Share", width: 52, align: "end", sortValue: (row) => row.share, render: (row) => `${(row.share * 100).toFixed(row.share < 0.001 ? 3 : 2)}%` },
];

function sessionContentWorld(): ContentWorld | null {
  const loaded = getDefaultWorldSession().getLoadedWorld();
  return loaded === null ? null : { planes: loaded.planes, palette: loaded.palette };
}

/**
 * Tiles per content id with its map colour. The count runs in slices between frames, so a large world never blocks
 * input; progress shows in the panel. Later this table is also where a material is picked for painting.
 */
export function ContentPanel({ world }: { readonly world?: ContentWorld | null }): React.JSX.Element {
  const summary = useAppStore((state) => state.summary);
  const sessionWorld = useMemo(() => (summary === null ? null : sessionContentWorld()), [summary]);
  const shown = world === undefined ? sessionWorld : world;
  // Only a signal that a count finished: the counts live in `countCache`, keyed by the planes, outside React.
  const [, setCompleted] = useState(0);
  const [progress, setProgress] = useState<{ readonly planes: CountablePlanes; readonly done: number } | null>(null);
  const [kind, setKind] = useState<ContentKind | "all">("all");
  const [selected, setSelected] = useState<string | null>(null);

  const cached = shown === null ? undefined : countCache.get(shown.planes);

  useEffect(() => {
    if (shown === null || countCache.has(shown.planes)) return undefined;
    const controller = new AbortController();
    countContentInSlices(shown.planes, shown.palette.length, {
      signal: controller.signal,
      onProgress: (done, total) => {
        setProgress({ planes: shown.planes, done: done / total });
      },
    }).then((result) => {
      countCache.set(shown.planes, result);
      setCompleted((count) => count + 1);
    }, (error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
    });
    return () => {
      controller.abort();
    };
  }, [shown]);

  const rows = useMemo(() => (shown === null || cached === undefined ? null : contentRows(shown, cached)), [shown, cached]);
  const filtered = useMemo(() => (rows === null || kind === "all" ? rows : rows.filter((row) => row.kind === kind)), [rows, kind]);

  if (shown === null) return <p className="panel-empty">Open a world to count its content.</p>;
  if (filtered === null) {
    return (
      <div className="panel-progress">
        <span>Counting tiles…</span>
        <progress aria-label="Counting tiles" max={1} value={progress?.planes === shown.planes ? progress.done : 0} />
      </div>
    );
  }
  return (
    <Table
      id="content"
      label="Content"
      columns={COLUMNS}
      rows={filtered}
      rowKey={(row) => row.key}
      filterText={(row) => `${row.name} ${row.id}`}
      initialSort={{ column: "count", direction: "descending" }}
      selectedKey={selected}
      onSelect={(row) => {
        setSelected(row.key);
      }}
      filters={(
        <select aria-label="Kind" className="select" value={kind} onChange={(event) => {
          setKind(event.target.value as ContentKind | "all");
        }}>
          <option value="all">All kinds</option>
          <option value="block">Blocks</option>
          <option value="wall">Walls</option>
          <option value="liquid">Liquids</option>
        </select>
      )}
    />
  );
}
