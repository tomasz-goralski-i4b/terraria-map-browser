# @studio/web

The browser viewer: React 19 + strict TypeScript on Vite, installable as a PWA (`vite-plugin-pwa` / Workbox).

```bash
pnpm --filter @studio/web dev       # dev server, prints the local URL
pnpm --filter @studio/web build     # production build into apps/web/dist (manifest + service worker)
pnpm --filter @studio/web preview   # serve the production build
```

The workspace packages are consumed through their built `dist/`: run `pnpm build` once from the repository root first
(`bash scripts/build.sh` does it).

## Rule: world data stays outside React

World data — Canonical World Model planes (typed arrays) and the `ContentRef` palette — never goes into React state
or the Zustand store, and is never copied into them. They hold only UI state and *references* (ids, handles) to data
that lives outside React (module-level owners, Workers, later OPFS). Components read through those references and
the renderer (`@studio/renderer`, framework-free) draws from them.

## Offline

The service worker precaches the built app shell only. User files (worlds, game assets) are never cached by it.
