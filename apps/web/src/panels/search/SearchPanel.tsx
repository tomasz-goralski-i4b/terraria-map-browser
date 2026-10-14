import { useEffect, useRef } from "react";
import { useAppStore } from "../../store.js";
import { Icon } from "../../ui/Icon.js";
import { IconButton } from "../../ui/IconButton.js";
import { Segments } from "../../ui/Segments.js";
import { clearSearch, SEARCH_SCOPES, setSearchQuery, setSearchScope, stepSearch, useSearchStore } from "../../world/search-store.js";
import type { EntitiesSource } from "../chest-list.js";
import { ChestItemResults } from "./ChestItemResults.js";
import { ContentResults, type ContentSearchWorld } from "./ContentResults.js";

/** The last Find request a mounted Search section acted on. */
let handledRequest = 0;

/**
 * The one Search box of the dock: a scope (what is searched) and a query. Enter / F3 and Shift+Enter / Shift+F3 go to
 * the next and previous match; Escape or the clear button drops the query and every highlight.
 */
export function SearchPanel({ content, chests }: { readonly content?: ContentSearchWorld; readonly chests?: EntitiesSource }): React.JSX.Element {
  const hasWorld = useAppStore((state) => state.summary !== null);
  const scope = useSearchStore((state) => state.scope);
  const query = useSearchStore((state) => state.query);
  const dim = useSearchStore((state) => state.dim);
  const requested = useSearchStore((state) => state.requested);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    // Only a new Find focuses the box; the section mounting again (tab switch, expand) leaves focus alone.
    if (requested === handledRequest) return;
    handledRequest = requested;
    input.current?.focus(); input.current?.select();
  }, [requested]);
  if (!hasWorld && content === undefined && chests === undefined) return <p className="panel-empty">Open a world to search it.</p>;
  const info = SEARCH_SCOPES.find((candidate) => candidate.id === scope) ?? SEARCH_SCOPES[0];
  return (
    <div className="search-panel">
      <div className="search-controls">
        <Segments label="Search in" disabled={false} value={scope} onChange={setSearchScope}
          options={SEARCH_SCOPES.map((candidate) => ({ id: candidate.id, label: candidate.label }))} />
        <div className="search-box">
          <label className="search-field">
            <Icon name="search" />
            <input
              ref={input} type="search" aria-label={`Search ${info?.label ?? ""}`} placeholder={info?.placeholder} value={query}
              aria-keyshortcuts="Enter Shift+Enter F3 Shift+F3 Escape"
              onChange={(event) => { setSearchQuery(event.target.value); }}
              onKeyDown={(event) => {
                if (event.key === "Enter") { event.preventDefault(); stepSearch(event.shiftKey ? -1 : 1); }
                else if (event.key === "Escape" && query !== "") { event.preventDefault(); event.stopPropagation(); clearSearch(); }
              }}
            />
          </label>
          <IconButton icon="close" label="Clear search" disabled={query === ""} onClick={() => { clearSearch(); input.current?.focus(); }} />
          {scope === "content" && (
            <IconButton icon={dim ? "eyeOff" : "eye"} label="Dim the rest of the world" pressed={dim} tooltipSide="left"
              onClick={() => { useSearchStore.setState({ dim: !dim }); }} />
          )}
        </div>
      </div>
      {scope === "content" ? <ContentResults {...(content === undefined ? {} : { world: content })} /> : <ChestItemResults {...(chests === undefined ? {} : { source: chests })} />}
    </div>
  );
}
