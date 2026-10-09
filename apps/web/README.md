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

## Exporting a world copy

**Open world…** picks a `.wld` file; **Open folder…** lists the `.wld` worlds in a selected writable folder.
The first folder selection explains Windows' default `Documents\My Games\Terraria\Worlds` location and offers
**Don't show again**. The explanation and world chooser close with their close button, Escape or backdrop.
Both native open pickers start in Documents on first use and share a remembered world-folder location.
The file picker uses a world-specific MIME filter and excludes the generic all-files option.

App menu → **Save world copy…** works immediately after either opening flow. A world opened from a folder saves
its copy there; a separately opened file asks for a writable folder. Sources without a handle use download.
Every save serializes the current decoded CWM, including edits made after an earlier export.
**Export world…** prepares a downloadable copy using the same writer in a separate Worker.
The same writer path handles unchanged and edited tile planes. All 18 reader-admitted formats (269–279, 315–319,
325–326) retain their source version; older-format write validation remains experimental and synthetic-tested.
Unsupported content and invalid footers show the writer's reason and produce no writable output.

**Save world copy…** creates `<file-name>.copy.wld` only after successful encoding. Existing files
are refused; the source identity is checked before any writable stream is created, including after a raced creation.
The directory picker replaces `showSaveFilePicker`, which can truncate a selected file before returning its handle
([File System Access §3.4](https://wicg.github.io/file-system-access/#api-showsavefilepicker)). This satisfies the
original-file protection requirement; a save picker followed by `isSameEntry` cannot satisfy it.
Download is always available; worlds opened through the file input or drag-and-drop without a source handle, or
browsers without directory selection, use this fallback. Save and Download use the same button styling.
The export message has a close button which cancels pending work and releases its download URL without closing
the loaded world. Opening another world or resetting also cancels work and releases
download URLs. A snapshot of the current CWM and preserved envelope is copied in yielding 1 MiB slices and transferred
to the Worker, preserving byte-view aliases and leaving the live world's buffers attached. Tile runs may be combined
into canonical RLE, changing file bytes, lengths and section offsets while preserving all decoded tile values,
metadata and opaque sections. The generated format-326 fixture also remains byte-identical in the browser test.
