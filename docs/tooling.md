# Tooling

Toolchain decisions and the reasons behind them. Change a version here in the same PR that changes it in the build.

## TypeScript

| What | Choice | Where |
|---|---|---|
| Node.js | 24 (Active LTS) | `.node-version`, `package.json` `engines` (`^24.12.0`), CI `actions/setup-node` `node-version-file` |
| Package manager | pnpm 11.28.2 | `package.json` `packageManager`, CI `pnpm/action-setup@v6` |
| Compiler (`tsc -b`) | TypeScript 7.0 (native), installed as the alias `typescript7` | `pnpm-workspace.yaml` `catalog` |
| TypeScript API (lint, editors) | TypeScript 6.0 via `@typescript/typescript6`, installed as `typescript` | `pnpm-workspace.yaml` `catalog` |
| Linter | ESLint 10 + `@eslint/js` 10 + `typescript-eslint` 8 (`strictTypeChecked` + `stylisticTypeChecked`) | `eslint.config.js` |
| Tests | Vitest 5, one project per package | `vitest.config.ts` |
| Node types | `@types/node` 24 | `pnpm-workspace.yaml` `catalog` |

All shared dev dependency versions live in the `catalog:` of `pnpm-workspace.yaml`; `package.json` files reference
them as `"catalog:"`. `catalogMode: strict` makes `pnpm add` use the catalog instead of writing a version range.

### Exceptions to "latest stable major"

`pnpm outdated -r` is expected to list only the packages below.

| Tool | Pinned | Latest | Blocker | Upgrade trigger |
|---|---|---|---|---|
| pnpm | 11.x | 12.x | pnpm 12 ships as a native executable (`@pnpm/exe.*`). A globally installed pnpm 10 switches to the `packageManager` version by running the downloaded `pnpm` file as JavaScript, which fails with `SyntaxError` on the binary — so every `pnpm` call (and `scripts/verify.sh`) breaks on machines still on pnpm 10, which includes the agent machines today. pnpm 11 is still JavaScript and pnpm 10 can switch to it. | Every dev/agent machine has a global pnpm ≥ 11 (it can switch to 12). Then set `packageManager` to `pnpm@12`; `pnpm/action-setup` must be ≥ v6.1 (first release with pnpm 12 support). |
| `@types/node` | 24.x | 26.x | Types must match the Node major we run (24, the Active LTS); `@types/node` 26 would type APIs that Node 24 does not have. | Node 26 becomes Active LTS (October 2026): bump `.node-version`, `engines` and `@types/node` together. |
| `typescript` (the module) | 6.0 (`@typescript/typescript6`) | 7.0 | `typescript-eslint` 8 supports TypeScript `>=4.8.4 <6.1.0` and needs the JavaScript compiler API, which TypeScript 7 (Go) does not ship. The compiler itself *is* on 7.0 (see below). | `typescript-eslint` declares TypeScript 7 support (peer range includes `7`): drop the `typescript7` alias and point `typescript` at `typescript@7`. |

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
| `isolatedDeclarations` (library packages: `packages/world-model`) | Exported API needs explicit types so declarations can be emitted per file without type checking; keeps the public surface deliberate. Apps will not need it. |
| `noImplicitReturns`, `noPropertyAccessFromIndexSignature`, `allowUnreachableCode: false`, `allowUnusedLabels: false` | Stricter checks that cost nothing on the current code. |
| `moduleDetection: "force"`, `libReplacement: false` | Current `tsc --init` defaults: every file is a module; no lookup of `@typescript/lib-*` replacement packages. |
| `declarationMap`, `sourceMap` | Go-to-definition and stack traces land in `src/`, not `dist/`. |
| `target`/`lib` `ES2024` | Everything ES2024 is available in Node 24 (and current browsers for the future PWA). |

Considered and not enabled:

- `rewriteRelativeImportExtensions` — only needed when sources import `./x.ts`; we import `./x.js` under `NodeNext`.
- `module: "node20"` — `NodeNext` already tracks the newest Node module semantics; `node20` would freeze them.
- `strictBuiltinIteratorReturn`, `useUnknownInCatchVariables` and the other `strict` family members — already on via `strict`.

### Lint

- `eslint.config.js` uses ESLint's `defineConfig`/`globalIgnores` (`tseslint.config` is deprecated).
- Type-aware linting uses `parserOptions.projectService`. To confirm it still runs, a floating promise or an
  `async` function without `await` must fail `pnpm lint` (`no-floating-promises`, `require-await`).
- Unused `eslint-disable` directives and unused inline configs are errors.

### Tests

`vitest.config.ts` creates one Vitest project per `packages/*` / `apps/*` directory that has a `src/`, named after
the package (`[@studio/world-model]` in the output). Only `src/**/*.test.ts` is collected, so the compiled copies in
`dist/` never run twice. A new package with tests is picked up without touching the config.

### pnpm settings

- Build scripts: pnpm 11 replaced `onlyBuiltDependencies` with `allowBuilds`. The list is explicit and empty —
  Vite 8 (via Vitest 5) uses Rolldown, whose native binding is a prebuilt optional dependency, so `esbuild` and its
  postinstall script are gone. A new dependency with an install script is reported by `pnpm install` and must be
  added to `allowBuilds` deliberately.
- pnpm 11 applies a built-in 24-hour `minimumReleaseAge` and re-checks lockfile entries against it, so a version
  published in the last day is not picked (supply-chain cooldown). Do not add `minimumReleaseAgeExclude` entries
  just to get a day-old release.

### Updating a TypeScript dev dependency

1. Change the range in the `catalog:` of `pnpm-workspace.yaml`.
2. `pnpm install` — refreshes `pnpm-lock.yaml`.
3. Update the tables above, commit both files, `bash scripts/verify.sh`.

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
