import { useEffect, useMemo } from "react";
import { getDefaultWorldSession } from "../../world/world-session.js";
import { buildContentStepIndex, matchContent, selectionOf } from "../../world/content-search.js";
import { stepSearch, useSearchStore } from "../../world/search-store.js";
import { useContentRows, type ContentRow, type ContentWorld } from "../ContentPanel.js";
import { MaterialSwatch } from "../material-swatch.js";

const KIND_LABELS: Readonly<Record<ContentRow["kind"], string>> = { block: "Block", wall: "Wall", liquid: "Liquid" };

/** The world size the step index walks; the loaded world's unless given. */
export interface ContentSearchWorld extends ContentWorld { readonly width: number; readonly height: number }

function loadedSize(): { readonly width: number; readonly height: number } | null {
  const loaded = getDefaultWorldSession().getLoadedWorld();
  return loaded === null ? null : { width: loaded.metadata.width, height: loaded.metadata.height };
}

/**
 * The "Content" scope: blocks, walls and liquids whose name or ID contains the query, with their tile counts. All of
 * them are highlighted on the map (the rest dimmed); choosing one narrows to it. F3 steps through the tiles.
 */
export function ContentResults({ world }: { readonly world?: ContentSearchWorld }): React.JSX.Element {
  const { shown, rows, progress } = useContentRows(world);
  const query = useSearchStore((state) => state.query);
  const contentFilter = useSearchStore((state) => state.contentFilter);
  const stepIndex = useSearchStore((state) => state.stepIndex);
  const position = useSearchStore((state) => state.position);
  const matches = useMemo(() => (rows === null ? [] : matchContent(rows, query).sort((a, b) => b.count - a.count)), [rows, query]);
  const chosen = useMemo(() => {
    const entry = contentFilter === null ? undefined : matches.find((match) => match.key === contentFilter);
    return entry === undefined ? matches : [entry];
  }, [matches, contentFilter]);

  // The highlight and its step index follow the chosen entries; the index is built in slices and dropped when stale.
  useEffect(() => {
    const size = world ?? loadedSize();
    if (shown === null || size === null || chosen.length === 0) {
      useSearchStore.setState({ highlight: null, stepIndex: null, position: null });
      return undefined;
    }
    const selection = selectionOf(chosen);
    useSearchStore.setState({ highlight: selection, stepIndex: null, position: null });
    const controller = new AbortController();
    buildContentStepIndex(shown.planes, size.width, size.height, selection, { signal: controller.signal }).then((index) => {
      if (controller.signal.aborted) return;
      useSearchStore.setState({ stepIndex: index });
      if (useSearchStore.getState().stepPending) {
        useSearchStore.setState({ stepPending: false });
        stepSearch(1);
      }
    }, (error: unknown) => {
      if (!(error instanceof DOMException && error.name === "AbortError")) throw error;
    });
    return () => { controller.abort(); };
  }, [shown, world, chosen]);

  if (shown === null) return <p className="panel-empty">Open a world to search its content.</p>;
  if (rows === null) {
    return (
      <div className="panel-progress">
        <span>Counting tiles…</span>
        <progress aria-label="Counting tiles" max={1} value={progress} />
      </div>
    );
  }
  const searching = query.trim() !== "";
  const tiles = chosen.reduce((sum, entry) => sum + entry.count, 0);
  const what = chosen.length === 1 ? chosen[0]?.name ?? "" : `${String(chosen.length)} entries`;
  const where = position === null || stepIndex === null ? "" : ` · ${position.ordinal.toLocaleString("en-US")} of ${stepIndex.total.toLocaleString("en-US")}`;
  const summary = !searching ? "Type a block, wall or liquid name, or its ID."
    : matches.length === 0 ? "No content matches."
    : `${what}: ${tiles.toLocaleString("en-US")} ${tiles === 1 ? "tile" : "tiles"}${where}`;

  return (
    <>
      <p className="search-summary" role="status">{summary}</p>
      {matches.length > 0 && (
        <ul className="search-entries" aria-label="Matching content">
          {matches.map((row) => (
            <li key={row.key}>
              <button
                type="button" className="search-entry" aria-pressed={contentFilter === row.key}
                title={contentFilter === row.key ? "Show every match" : `Show only ${row.name}`}
                onClick={() => { useSearchStore.setState({ contentFilter: contentFilter === row.key ? null : row.key, position: null }); }}
              >
                <span className="search-entry-icon">
                  {row.kind === "liquid" || row.ref === undefined
                    ? <span className="swatch" style={{ backgroundColor: `rgb(${String(row.color[0])} ${String(row.color[1])} ${String(row.color[2])})` }} aria-hidden="true" />
                    : <MaterialSwatch color={(row.color[0] << 16) | (row.color[1] << 8) | row.color[2]} layer={row.kind} content={row.ref} />}
                </span>
                <span className="search-entry-name">{row.name}<span className="muted">{` · ${KIND_LABELS[row.kind]}`}</span></span>
                <span className="search-entry-count">{row.count.toLocaleString("en-US")}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
