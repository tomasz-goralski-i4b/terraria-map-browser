# Local viewer sources and benchmark

Start the app with `pnpm --filter @studio/web dev`, then serve a local world and the installed game's Images folder:

```sh
node scripts/dev/serve-local.mjs "C:/Worlds/ForestWorkshop.wld" "C:/Games/Terraria/Content/Images"
```

Open the printed **dev app** URL. If Vite chose a port other than 5173, change that URL's app port. The server binds
to `127.0.0.1` on an available port, reads the chosen files in place, and stops with Ctrl+C. It serves the selected
world and direct `.xnb` files only; nothing is copied into the repository. CORS permits HTTP loopback origins only.

The startup contract is `?world=<encoded world URL>&content=<encoded Images base URL>`. Both are required. Only
`http://localhost`, `http://127.0.0.1` and `http://[::1]` are accepted; credentials, redirects, remote hosts, HTTPS and
file URLs are rejected before loading. This startup hook exists only in Vite dev builds. Production ignores the
parameters and offers the normal file/folder pickers.

An Images base URL provides `index.json`:

```json
{
  "name": "Images",
  "entries": [
    { "name": "Tiles_0.xnb", "size": 5048, "lastModified": 1700000000000 },
    { "name": "Wall_1.xnb", "size": 5376, "lastModified": 1700000000000 }
  ]
}
```

Names are unique, case-insensitively, and contain no paths or URL components. Sizes are bytes and timestamps are
integer milliseconds since the Unix epoch. Sheet files live directly below the same base URL. The app selects atlas
sheet names with the existing case-insensitive atlas matcher, downloads up to four at a time and checks each size.
The listing's timestamps preserve the atlas cache fingerprint. HTTP sources are not saved as native folder handles.

Add `?perf` (or `&perf`) in dev or production to show FPS, frame interval p50/p95, chunk uploads in the last sampled
display frame, resident chunks, actual draw mode (`overview`, `chunks`, `sprites`) and backing-store pixels per tile.
Before opening a world these figures are zero. FPS is 1000 divided by the mean of consecutive `requestAnimationFrame`
intervals; p50/p95 use nearest-rank percentiles over the last 120 intervals. These are display-frame timings, including
main-thread stalls, not GPU completion timings or a CPU-only draw duration. A resting map can report the display's
refresh rate without issuing new draws. Uploads count the renderer's chunk work, including rebuilding overview chunks,
and exclude palette/atlas/background uploads and idle prefetch outside the draw. The overlay refreshes four times a
second. Without `?perf` or a running benchmark, there is no sampling animation loop.

With a world open in dev, run in the browser console:

```js
console.table(await window.__studioBench.run({ steps: 12, panMs: 500 }));
```

The benchmark fits the world, then sends one wheel notch (`deltaY = -120`) at the canvas centre per step, waits for
zoom to settle and drags horizontally at 0.384 CSS pixels/ms for `panMs`, alternating direction. It uses the same wheel
and pointer handlers as human input, ends each drag without inertia and leaves the final camera in place. Avoid other
input during a run. Each row contains `step`, `zoom`, `mode`, `fps`, `p50`, `p95`, `maxFrame`, `uploads` and
`residentChunks`. Timings and total chunk uploads cover the entire wheel-and-pan step; this uses every interval in
that step, independently of the rolling overlay window. Steps must be integers from 1 to 100, and pan durations must
be finite and between 50 and 60000 ms. Concurrent runs are rejected. Closing the map rejects a pending run and removes
the benchmark hook. Production exposes no benchmark.

Run the server integration tests with `node --test scripts/dev/serve-local.test.mjs`; they also run through Vitest in
`scripts/verify.sh`. The generated-world/XNB browser flow and timing benchmark are tagged `perf` for local execution.
