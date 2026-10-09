# Tooling

Toolchain decisions and the reasons behind them. Change a version here in the same PR that changes it in the build.

## TypeScript

| What | Choice | Where |
|---|---|---|
| Node.js | 24 (Active LTS [S4]) | `.node-version`, `package.json` `engines` (`^24.12.0`), CI `actions/setup-node` `node-version-file` |
| Package manager | pnpm 11.28.2 | `package.json` `packageManager`, CI `pnpm/action-setup@v6` |
| Compiler (`tsc -b`) | TypeScript 7.0 (native), installed as the alias `typescript7` | `pnpm-workspace.yaml` `catalog` |
| TypeScript API (lint, editors) | TypeScript 6.0 via `@typescript/typescript6`, installed as `typescript` | `pnpm-workspace.yaml` `catalog` |
| Linter | ESLint 10 + `@eslint/js` 10 + `typescript-eslint` 8 (`strictTypeChecked` + `stylisticTypeChecked`) | `eslint.config.js` |
| Tests | Vitest 5, one project per package | `vitest.config.ts` |
| Browser tests | `@vitest/browser-playwright` 5 (matches Vitest) + Playwright 1.63, headless Chromium | `vitest.config.ts`, CI browser install |
| Web app | React 19, Vite 8, `vite-plugin-pwa` (see the Web app section) | `apps/web`, `pnpm-workspace.yaml` `catalog` |
| Node types | `@types/node` 24 | `pnpm-workspace.yaml` `catalog` |

All shared dev dependency versions live in the `catalog:` of `pnpm-workspace.yaml`; `package.json` files reference
them as `"catalog:"`. `catalogMode: strict` makes `pnpm add` use the catalog instead of writing a version range.

### Exceptions to "latest stable major"

`pnpm outdated -r` is expected to list only the packages below.

| Tool | Pinned | Latest | Blocker | Upgrade trigger |
|---|---|---|---|---|
| pnpm | 11.x | 12.x | pnpm 12 ships as a native executable (`@pnpm/exe.*` optional dependencies [S1]). A globally installed pnpm 10 switches to the `packageManager` version by running the downloaded `pnpm` file as JavaScript, which fails with `SyntaxError` on the binary — so every `pnpm` call (and `scripts/verify.sh`) breaks on machines still on pnpm 10, which includes the agent machines today (reproduced below). pnpm 11 is still JavaScript (`bin` → `bin/pnpm.mjs` [S2]) and pnpm 10 can switch to it. | Every dev/agent machine has a global pnpm ≥ 11 (it can switch to 12). Then set `packageManager` to `pnpm@12`; `pnpm/action-setup` must be ≥ v6.1 (first release with pnpm 12 support [S3]). |
| `@types/node` | 24.x | 26.x | Types must match the Node major we run (24, the Active LTS [S4]); `@types/node` 26 would type APIs that Node 24 does not have. | Node 26 becomes Active LTS on 2026-10-28 [S4]: bump `.node-version`, `engines` and `@types/node` together. |
| `typescript` (the module) | 6.0 (`@typescript/typescript6`) | 7.0 | `typescript-eslint` 8 supports TypeScript `>=4.8.4 <6.1.0` [S5] and needs the JavaScript compiler API; the root export of `typescript@7` is only a version stub, the API is under `./unstable/*` [S6]. The compiler itself *is* on 7.0 (see below). | `typescript-eslint` declares TypeScript 7 support (peer range includes `7`): drop the `typescript7` alias and point `typescript` at `typescript@7`. |

#### Evidence: pnpm 10 cannot switch to pnpm 12

Reproduced on 2026-10-06 (Windows 11, Node.js v24.14.1, global pnpm 10.34.6 from npm) in an empty directory with
its own `pnpm-workspace.yaml` (`packages: []`), changing only `packageManager` in `package.json`:

```text
$ pnpm --version        # "packageManager": "pnpm@12.9.1"
file:///C:/Users/<user>/AppData/Local/pnpm/.tools/pnpm/12.9.1_tmp_51232_0/node_modules/pnpm/pnpm:1
MZ�

SyntaxError: Invalid or unexpected token
    at compileSourceTextModule (node:internal/modules/esm/utils:318:16)
    ...
Node.js v24.14.1
exit=1

$ pnpm --version        # "packageManager": "pnpm@11.28.2"
11.28.2
exit=0
```

`MZ` is the header of a Windows PE executable: pnpm 10 loads the native pnpm 12 binary as an ES module.

### Two TypeScript versions, one build

- `pnpm typecheck` (`tsc -b`) runs the `tsc` binary of `typescript7` (TypeScript 7.0, the native compiler).
  This is the build of record for `scripts/build.sh` and CI.
- `typescript-eslint` resolves `require("typescript")` to the TypeScript 6.0 API, so type-aware rules
  (`strictTypeChecked`) keep running against a real type checker. Editors that use the workspace TypeScript also
  get 6.0. `pnpm exec tsc6 -b` runs the 6.0 compiler if a discrepancy needs to be checked.
- Both read the same `tsconfig` files. Every compiler option used here is supported by both; a TS 7-only option
  would have to wait until linting runs on TS 7 too.

### Compiler flags (`tsconfig.base.json`)

Kept from before: `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noImplicitOverride`,
`noFallthroughCasesInSwitch`, `noUnusedLocals`, `noUnusedParameters`, `verbatimModuleSyntax`, `isolatedModules`,
`declaration`, `composite`, `skipLibCheck`.

| Added | Why |
|---|---|
| `erasableSyntaxOnly` | Only type syntax that can be stripped (no `enum`, `namespace`, parameter properties) — the code runs under Node's type stripping and any transpiler without a TS-specific transform. |
| `noUncheckedSideEffectImports` | `import "./x"` must resolve; a typo in a side-effect import is an error instead of a silent no-op. |
| `isolatedDeclarations` (library packages: `packages/world-model`, `world-codec`, `renderer`, `assets`) | Exported API needs explicit types so declarations can be emitted per file without type checking; keeps the public surface deliberate. Apps will not need it. |
| `noImplicitReturns`, `noPropertyAccessFromIndexSignature`, `allowUnreachableCode: false`, `allowUnusedLabels: false` | Stricter checks that cost nothing on the current code. |
| `moduleDetection: "force"`, `libReplacement: false` | Current `tsc --init` defaults: every file is a module; no lookup of `@typescript/lib-*` replacement packages. |
| `declarationMap`, `sourceMap` | Go-to-definition and stack traces land in `src/`, not `dist/`. |
| `target`/`lib` `ES2024` | Everything ES2024 is available in Node 24 (and current browsers, the `apps/web` PWA). |

Considered and not enabled:

- `rewriteRelativeImportExtensions` — only needed when sources import `./x.ts`; we import `./x.js` under `NodeNext`.
- `module: "node20"` — `NodeNext` already tracks the newest Node module semantics; `node20` would freeze them.
- `strictBuiltinIteratorReturn`, `useUnknownInCatchVariables` and the other `strict` family members — already on via `strict`.

### Lint

- `eslint.config.js` uses ESLint's `defineConfig`/`globalIgnores` (`tseslint.config` is deprecated [S7]).
- Type-aware linting uses `parserOptions.projectService`. To confirm it still runs, a floating promise or an
  `async` function without `await` must fail `pnpm lint` (`no-floating-promises`, `require-await`).
- Unused `eslint-disable` directives and unused inline configs are errors.

### Tests

`vitest.config.ts` creates one Node Vitest project per `packages/*` / `apps/*` directory that has a `src/`, named
after the package (`[@studio/world-model]` in the output). It collects `src/**/*.test.ts` and `tests/**/*.test.ts`,
excluding `*.browser.test.ts`, so compiled copies in `dist/` never run twice. New Node tests are picked up without
touching the config.

`@studio/world-codec/browser` runs `tests/**/*.browser.test.ts` in real headless Chromium through
[Vitest's Playwright provider](https://vitest.dev/config/browser/playwright). The package implements the TS codec
(header, metadata, tiles → CWM) and exposes a Worker entry (`@studio/world-codec/worker`); the browser tests
(`worker.browser.test.ts`, `world-worker.browser.test.ts`, fixtures in `tests/fixtures/`) run it in a real module
Worker. A separate Node smoke imports the package export without `window` or `Worker` globals. Build before these
tests so `dist/` and declarations exist.

Browser projects are registered explicitly in `vitest.config.ts` (`browserProjects`), because each may need its own
plugins or commands; add one there for each new package containing `tests/**/*.browser.test.{ts,tsx}`. Loading the
config fails with the package name when browser tests exist without a browser project, so they cannot be skipped
silently (follow-up #69). Vitest saves failure screenshots under `.vitest/attachments/`;
`.vitest/` is gitignored so red-phase browser runs cannot stage generated binary artifacts through `git add -A`.

Install the matching browser once locally with `pnpm exec playwright install chromium`. CI caches
`~/.cache/ms-playwright` per Playwright version and, only on a cache miss, runs
`pnpm exec playwright install --with-deps --only-shell chromium` (headless tests need only the headless shell;
`--with-deps` adds the Linux system libraries, which the runner image already has on a hit)
([Playwright browser setup](https://playwright.dev/docs/browsers)). Browser installation is an explicit setup
step, not a dependency install hook. `bash scripts/verify.sh` runs the full build (.NET, `tsc -b`, Vite), lint with zero
warnings, the contract and fixture checks, all Node and browser Vitest projects (`scripts/test.sh`) and the
inspector smoke. CI runs it as two parallel jobs on separate runners, `verify (dotnet)` and `verify (web)`, by setting
`STUDIO_VERIFY_PART=dotnet` (restore, build, `dotnet test`, inspector smoke) or `=web` (everything else); the two
halves together are exactly the unset run, which local and agent-gate runs keep using.

The Vitest tag `perf` (defined in `vitest.config.ts`) marks tests that are too slow or too timing-sensitive for the
shared CI runners, which render through SwiftShader: wall-clock bounds (a heartbeat or long-task bound), the
GPU-vs-`renderChunk` comparisons (`test(name, { tags: ["perf"] }, fn)`), and every `apps/web` UI test file
(`*.browser.test.tsx`), since those wait on UI flows (`// @module-tag perf` on the first line; a new file there adds it too). CI (pull requests
and pushes to `main`) sets `STUDIO_SKIP_PERF=1`, and `scripts/test.sh` then passes `--tags-filter '!perf'`. Local
`verify.sh` runs, including the agent gates, run every test: they are what guards these tests.

**Decision (2026-10-07, follow-up #69):** headless Chromium is a confirmed prerequisite — in CI (the install step
in `.github/workflows/ci.yml`) and on every machine that runs `verify.sh`, including agent worktrees. The browser
viewer (`apps/web`) and the Worker codec are tested in a real browser, so the extra CI time is accepted. Agent
worktrees share the user-level Playwright browser cache, so one local install covers all of them.

For focused checks: `pnpm --filter @studio/world-codec build`, `pnpm --filter @studio/world-codec lint`,
`pnpm --filter @studio/world-codec test`, and `pnpm --filter @studio/world-codec test:browser`.

### pnpm settings

- Build scripts: pnpm 11 replaced `onlyBuiltDependencies` with `allowBuilds` [S8]. The list is explicit and empty —
  Vite 8 (via Vitest 5) uses Rolldown, whose native binding is a prebuilt optional dependency
  (`@rolldown/binding-*` [S9]), so `esbuild` and its postinstall script are gone. A new dependency with an install
  script is reported by `pnpm install` and must be added to `allowBuilds` deliberately [S8].
- pnpm 11 applies a built-in 24-hour `minimumReleaseAge` (default `1440` minutes [S8]), so a version published in
  the last day is not picked (supply-chain cooldown). Do not add `minimumReleaseAgeExclude` entries just to get a
  day-old release.

### Updating a TypeScript dev dependency

1. Change the range in the `catalog:` of `pnpm-workspace.yaml`.
2. `pnpm install` — refreshes `pnpm-lock.yaml`.
3. Update the tables above, commit both files, `bash scripts/verify.sh`.

### Sources

Upstream facts above, pinned to the release they were checked against (2026-10-06). Facts about this repository
point at its own files (see the "Where" column).

- [S1] `pnpm@12.9.1` registry metadata — `optionalDependencies` `@pnpm/exe.<os>-<arch>`:
  `npm view pnpm@12.9.1 optionalDependencies`, file view https://unpkg.com/pnpm@12.9.1/package.json
- [S2] `pnpm@11.28.2` registry metadata — `"bin": { "pnpm": "bin/pnpm.mjs" }`:
  https://unpkg.com/pnpm@11.28.2/package.json
- [S3] `pnpm/action-setup` v6.1.0 release notes, "feat: support pnpm v12" (pnpm/action-setup#288):
  https://github.com/pnpm/action-setup/releases/tag/v6.1.0
- [S4] Node.js release schedule, `nodejs/Release` `schedule.json` at commit `72fdab2`, lines 134–152
  (`v24` LTS 2025-10-28; `v26` LTS 2026-10-28):
  https://github.com/nodejs/Release/blob/72fdab20216c5f04e0a0fe72a225c2504e9f2b42/schedule.json#L134-L152
- [S5] `typescript-eslint` v8.71.0 `packages/typescript-eslint/package.json` line 61,
  `"typescript": ">=4.8.4 <6.1.0"`:
  https://github.com/typescript-eslint/typescript-eslint/blob/v8.71.0/packages/typescript-eslint/package.json#L61;
  also https://typescript-eslint.io/users/dependency-versions/#typescript
- [S6] `typescript@7.0.2` `package.json` `exports` — `"."` → `./lib/version.cjs`, compiler API only under
  `./unstable/*`: https://unpkg.com/typescript@7.0.2/package.json
- [S7] `typescript-eslint` v8.71.0 `packages/typescript-eslint/src/config-helper.ts` lines 91–92 (`@deprecated`,
  use ESLint's `defineConfig()`):
  https://github.com/typescript-eslint/typescript-eslint/blob/v8.71.0/packages/typescript-eslint/src/config-helper.ts#L91-L92
- [S8] pnpm v11.0.0 release notes — "`allowBuilds` replaces the old build-dependency settings", "Removed
  deprecated build dependency settings" (pnpm/pnpm#11220), "`minimumReleaseAge` is now `1440` (1 day)"
  (pnpm/pnpm#11158): https://github.com/pnpm/pnpm/releases/tag/v11.0.0; setting reference
  https://pnpm.io/settings/build#allowbuilds
- [S9] `vite@8.3.2` (resolved by Vitest 5.0.3, peer `vite: ^6.4.0 || ^7.0.0 || ^8.0.0`) depends on
  `rolldown ~1.2.11` and not on `esbuild`; `rolldown@1.2.11` ships `@rolldown/binding-*` optional dependencies:
  https://unpkg.com/vite@8.3.2/package.json, https://unpkg.com/rolldown@1.2.11/package.json

## Web app (`apps/web`, `packages/renderer`)

| Dependency | Why |
|---|---|
| `react` / `react-dom` 19 | UI of the viewer/editor (M4–M7). The renderer package stays framework-free. |
| `zustand` 5 | Small UI-state store. World data (CWM planes, palette) never goes into it — see `apps/web/README.md`. |
| `vite` 8 | Dev server and production build; the same version Vitest 5 already resolves, so the tree has one Vite. |
| `@vitejs/plugin-react` | JSX/Fast Refresh for the app and for its Vitest browser project (also a root devDependency because `vitest.config.ts` imports it). |
| `vite-plugin-pwa` 2 (Workbox) | Web app manifest and a generated service worker that precaches the built shell only (no runtime caching of user files). `base: "./"` keeps the build relocatable. |
| `vitest-browser-react` | Renders React components in the real-Chromium Vitest browser project. |
| `eslint-plugin-react-hooks` 7 | Rules of Hooks; applied only to `apps/web/**` in `eslint.config.js` (also a root devDependency). |
| `@types/react`, `@types/react-dom` | Types for React 19. |
| `axe-core` 4.13 (dev only) | Accessibility check of the main screen in `apps/web/tests/editor-shell.browser.test.tsx` (both themes). Pinned to a minor released at least two weeks before it was added. |

UI primitives (virtualised table, splitter, menus, tooltips, icons) are written in-house; there is no UI component
library. The rules for new UI are in [`docs/ui.md`](ui.md).

`packages/renderer` (`@studio/renderer`) is framework-free: `no-restricted-imports` in `eslint.config.js` and a test in
`packages/renderer/tests` fail if it imports React.

`packages/assets` (`@studio/assets`) reads Terraria `.xnb` textures (uncompressed and LZX) into RGBA with no runtime
dependencies; its synthetic XNB/LZX inputs are built in `src/xnb-fixture.ts`. `tests/terraria-content.test.ts` runs
against a local install only when `TERRARIA_CONTENT` is set (CI never sets it; the tests are then skipped).

`scripts/build.sh` runs `vite build` after `tsc -b`. The `@studio/web/browser` Vitest project
(`apps/web/tests/**/*.browser.test.ts(x)`) serves the production build under `/pwa-app/` through a test-only Vite
plugin (`apps/web/tests/support/dist-server.ts`) so `pwa.browser.test.ts` can register the real service worker, cut the
"network" (the plugin drops every request) and prove the shell still loads. Run `pnpm build` before that test.
`pnpm --filter @studio/web dev|build|preview` run the app.

## .NET

| What | Choice | Where |
|---|---|---|
| SDK | .NET 10 (`10.0.100`, `rollForward: latestFeature`) | `global.json` |
| Target framework | `net10.0` | every `.csproj` |
| Solution | `dotnet/TerrariaMapStudio.slnx` (XML solution format) | `scripts/lib.sh` `SLN` |
| Package versions | Central Package Management | `dotnet/Directory.Packages.props` |
| Restores | `packages.lock.json` per project, locked mode in CI | `dotnet/Directory.Build.props`, `scripts/build.sh` |
| Test framework | xUnit v3 `xunit.v3` 4.0.1 | `dotnet/Directory.Packages.props` |
| Test runner | Microsoft.Testing.Platform 2.4.0 (transitive via `xunit.v3.mtp-v2`) | `global.json` `test.runner` |

### Why

- **`.slnx`** — the XML solution format has no GUIDs and no per-configuration platform matrix, so it is a few
  lines long and merges cleanly when parallel agents add projects. Created with `dotnet sln migrate`; the
  `x64`/`x86` platform entries it generated were dropped because every project builds as `Any CPU`.
- **Central Package Management** — one place to bump a version, no drift between projects. `.csproj` files
  carry `<PackageReference Include="…" />` without `Version=`. `CentralPackageTransitivePinningEnabled` lets a
  `PackageVersion` entry also pin a transitive dependency (e.g. for a security fix).
- **Lock files** — `RestorePackagesWithLockFile` writes `packages.lock.json` next to each project; they are
  committed. When `CI=true` (GitHub Actions sets it), `scripts/build.sh` runs `dotnet restore --locked-mode`
  and `Directory.Build.props` sets `RestoreLockedMode`, so CI fails instead of silently resolving something
  different from what was reviewed. Locally, a restore updates the lock file — commit it with the change.
- **`ContinuousIntegrationBuild`** — set when `CI=true`: normalises source paths in PDBs so CI builds are
  reproducible. Together with `Deterministic` it makes CI output independent of the checkout path.
- **xUnit v3 on Microsoft.Testing.Platform** — xUnit v3 test projects are self-hosting executables
  (`OutputType=Exe`); 4.x runs on MTP v2. This replaces `xunit` 2.x, `xunit.runner.visualstudio` and
  `Microsoft.NET.Test.Sdk` (VSTest), which are no longer needed. The .NET 10 SDK only runs MTP projects through
  `dotnet test` in its native MTP mode, enabled by `"test": { "runner": "Microsoft.Testing.Platform" }` in
  `global.json`; the command is therefore `dotnet test --solution <slnx>` (see `scripts/test.sh`).
- **No coverage collector** — `coverlet.collector` was a VSTest data collector and nothing consumed its output.
  It was removed with VSTest; add an MTP coverage extension (e.g. `Microsoft.Testing.Extensions.CodeCoverage`)
  when coverage is actually reported somewhere.
- **Quality rules unchanged** — `TreatWarningsAsErrors`, `Nullable`, `AnalysisLevel=latest-recommended` and
  `EnforceCodeStyleInBuild` stay as they were (`dotnet/Directory.Build.props`).

### Updating a package

1. Change the `Version` in `dotnet/Directory.Packages.props`.
2. `dotnet restore dotnet/TerrariaMapStudio.slnx` — refreshes the `packages.lock.json` files.
3. Update the table above, commit props + lock files together, `bash scripts/verify.sh`.

The `@studio/renderer/browser` and `@studio/web/browser` projects launch Chromium with `--use-angle=swiftshader
--enable-unsafe-swiftshader --ignore-gpu-blocklist` (`softwareWebGl` in `vitest.config.ts`): headless Chromium on a
machine without a GPU only offers WebGL2 through the SwiftShader software rasteriser.
