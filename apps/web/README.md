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

## Opening and saving worlds

The **File** menu works like an editor's:

- **Open World…** (`Ctrl+O`) picks a `.wld` file; dropping one on the map does the same.
- **Open Folder…** picks the worlds folder *read-only* and remembers it (IndexedDB) for later visits. Its worlds,
  newest first, are listed in **File ▸ Worlds** (a submenu that flies out on hover) and on the start screen. After a
  browser restart the folder may need one click (**Allow Access**) before it is listed again.
- **Open Recent** keeps the last eight worlds opened from a file handle.
- **Save As…** (`Ctrl+Shift+S`) is the one way to write a world. Its dialog names the file (the opened name, or the
  first free `name (n).wld` in the same folder), shows the destination folder (the folder the world came from, else
  the worlds folder, else one chosen with **Choose Folder…**) and offers **Download** instead.
- **Save** (`Ctrl+S`, writing back to the opened file) stays disabled until editing exists; `Ctrl+S` is still kept
  from the browser.

Saving encodes the current CWM with the TypeScript `writeWorld` in a Worker (the same path for unchanged and edited
tiles; all 18 reader-admitted formats keep their version), then reads the bytes back with the codec and compares
format, size, name and every tile plane (blocks and walls by the content they name). Only bytes that pass reach the
disk or the downloads, so the dialog can promise "read back before anything is written". Write access is asked for on
the Save click, never when a folder or world is opened. The opened world's own file is never overwritten (checked
with `isSameEntry` before and after the file is created); another existing file is replaced only after **Replace** is
confirmed, and never for a world dropped without a file handle (its identity cannot be checked). The browser writes
through a temporary file and swaps it in on close, so a failed save leaves the old file intact.

`showSaveFilePicker` is not used: it can create or truncate the chosen file before returning its handle, too early for
the identity check ([File System Access §3.4](https://wicg.github.io/file-system-access/#api-showsavefilepicker)).
A snapshot of the CWM is copied to the Worker in yielding 1 MiB slices, leaving the live world's buffers attached;
canonical RLE may change file bytes and section offsets while preserving every decoded value. Opening another world,
closing the world or cancelling the dialog cancels a save in progress. Results show as notifications in the map's
bottom-right corner.
