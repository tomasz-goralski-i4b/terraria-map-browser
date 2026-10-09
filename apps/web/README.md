# @studio/web

The browser viewer: React 19 + strict TypeScript on Vite, installable as a PWA (`vite-plugin-pwa` / Workbox).

```bash
pnpm --filter @studio/web dev       # dev server, prints the local URL
pnpm --filter @studio/web build     # production build into apps/web/dist (manifest + service worker)
pnpm --filter @studio/web preview   # serve the production build
```

The workspace packages are consumed through their built `dist/`: run `pnpm build` once from the repository root first
(`bash scripts/build.sh` does it).

## Layout and style

The viewer is laid out as a world editor: top bar, tool rail, tool options bar, the map, a dock of collapsible panel
sections and a status bar. Every action is a command in `src/shell/commands.ts` (menus, shortcuts, tooltips, the `?`
help and the `Ctrl+K` palette read that list). Primitives live in `src/ui/`, panels in `src/panels/`, tokens and all
styling in `src/styles.css`. Rules and patterns: [`docs/ui.md`](../../docs/ui.md).

## Rule: world data stays outside React

World data — Canonical World Model planes (typed arrays) and the `ContentRef` palette — never goes into React state
or the Zustand store, and is never copied into them. They hold only UI state and *references* (ids, handles) to data
that lives outside React (module-level owners, Workers, later OPFS). Components read through those references and
the renderer (`@studio/renderer`, framework-free) draws from them.

## Offline

The service worker precaches the built app shell only. User files (worlds, game assets) are never cached by it.

## Exporting an unchanged world

App menu → **Export world…** validates the opened file with the TypeScript writer in a separate Worker and exports
its exact original bytes, including the original tile encoding. All 18 reader-admitted formats (269–279, 315–319,
325–326) retain their source version; older-format write validation remains experimental and synthetic-tested.
Unsupported content and invalid footers show the writer's reason and produce no writable output.

Worlds opened with the system file picker retain their read-only source handle for an `isSameEntry` check. Export
suggests `<file-name>.copy.wld` and refuses the original entry before creating a writable stream. When the save
picker is unavailable, or the world was opened through the file input or drag-and-drop without a source handle,
export offers a download link. Opening another world or resetting the session cancels pending exports and releases
download URLs. The immutable opened `File` stays outside React; only that small File reference is cloned to the
export Worker, avoiding a main-thread clone of the CWM. This path must be replaced when editing is implemented.
